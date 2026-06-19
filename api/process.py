# -*- coding: utf-8 -*-
"""
Apex Voice Web - エージェント処理 (Vercel Python serverless)

POST /api/process
  Body: {"id": "<entry_id>"}
  Header: Authorization: Bearer <APEX_VOICE_TOKEN>

KVから対象エントリを取得し、Strands Agentで判定:
- Web検索系("〇〇調べて","〇〇教えて") → ページ取得+要約
- macOSローカル系の発話 → 何もしない(Apex Voice側で実行済み)
- 単なる文章 → 何もしない

結果はエントリの webResult に書き込み、status="done"に更新する。
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler
from typing import Any, Optional

import boto3
import requests
from bs4 import BeautifulSoup
from upstash_redis import Redis

# ============================================================
# Vercel OIDC → AWS STS AssumeRoleWithWebIdentity ブリッジ
# ============================================================
# Vercel が VERCEL_OIDC_TOKEN を渡してくれるが、boto3 は
# AWS_WEB_IDENTITY_TOKEN_FILE (ファイルパス) を要求する。
# そのため起動時にtokenを一時ファイルへ書き出し、環境変数を仕込む。
def _bootstrap_vercel_oidc():
    token = os.environ.get("VERCEL_OIDC_TOKEN")
    role_arn = os.environ.get("AWS_ROLE_ARN")
    if not token or not role_arn:
        return
    if os.environ.get("AWS_WEB_IDENTITY_TOKEN_FILE"):
        return  # 既に設定済み
    try:
        p = "/tmp/vercel_oidc_token"
        with open(p, "w") as f:
            f.write(token)
        os.environ["AWS_WEB_IDENTITY_TOKEN_FILE"] = p
        # boto3 がセッション名を要求するので念のため
        os.environ.setdefault("AWS_ROLE_SESSION_NAME", "apex-voice-web")
    except Exception as e:
        print(f"[oidc bootstrap] failed: {e}")


_bootstrap_vercel_oidc()

# ============================================================
# 設定
# ============================================================
BEDROCK_MODEL_ID = os.environ.get(
    "APEXVOICE_BEDROCK_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0"
)
BEDROCK_REGION = os.environ.get("APEXVOICE_BEDROCK_REGION", "us-east-1")
APEX_VOICE_TOKEN = os.environ.get("APEX_VOICE_TOKEN", "")

KV_URL = os.environ.get("KV_REST_API_URL", "")
KV_TOKEN = os.environ.get("KV_REST_API_TOKEN", "")

WEB_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible) ApexVoiceWeb/0.1",
    "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
}


# ============================================================
# KV クライアント (Upstash Redis REST互換)
# ============================================================
def _kv() -> Optional[Redis]:
    if not KV_URL or not KV_TOKEN:
        return None
    return Redis(url=KV_URL, token=KV_TOKEN)


def _entry_key(entry_id: str) -> str:
    return f"entry:{entry_id}"


def get_entry(entry_id: str) -> Optional[dict]:
    r = _kv()
    if r is None:
        return None
    raw = r.get(_entry_key(entry_id))
    if not raw:
        return None
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return None


def update_entry(entry_id: str, patch: dict) -> Optional[dict]:
    cur = get_entry(entry_id)
    if cur is None:
        return None
    cur.update(patch)
    r = _kv()
    if r is None:
        return cur
    r.set(_entry_key(entry_id), json.dumps(cur, ensure_ascii=False))
    return cur


# ============================================================
# Web取得 + 要約
# ============================================================
def _fetch_page_text(url: str, max_chars: int = 8000) -> str:
    r = requests.get(url, headers=WEB_FETCH_HEADERS, timeout=15)
    r.raise_for_status()
    soup = BeautifulSoup(r.content, "html.parser")
    for tag in soup(["script", "style", "noscript", "header", "footer",
                     "nav", "aside", "form", "iframe"]):
        tag.decompose()
    main = soup.find("article") or soup.find("main") or soup.body or soup
    text = " ".join(main.get_text(separator=" ", strip=True).split())
    return text[:max_chars]


def _google_first_url(query: str) -> Optional[str]:
    search_url = ("https://www.google.com/search?q="
                  + urllib.parse.quote_plus(query))
    try:
        r = requests.get(search_url, headers=WEB_FETCH_HEADERS, timeout=10)
        soup = BeautifulSoup(r.content, "html.parser")
        for a in soup.find_all("a"):
            href = a.get("href", "")
            if href.startswith("/url?q="):
                return urllib.parse.unquote(href.split("/url?q=")[1].split("&")[0])
            if href.startswith("http") and "google.com" not in href:
                return href
    except Exception:
        pass
    return None


# ============================================================
# 判定: 発話がWeb系か(LLMで分類)
# ============================================================
def _bedrock_client():
    return boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)


def classify_and_extract(text: str) -> dict:
    """発話を分類して必要パラメータを抽出。
    返り値: {"kind": "search"|"fetch"|"skip", "query": ..., "url": ..., "question": ...}"""
    sys_prompt = (
        "あなたは音声入力アシスタントの分類器です。ユーザー発話を以下のいずれかに分類:\n"
        " - search: 「〇〇調べて」「〇〇のニュース」「〇〇は?」等のWeb検索系\n"
        " - fetch: 特定のURLを取得・要約する依頼 (発話にURLが含まれる)\n"
        " - skip: macOS固有のアクション(リマインダー・カレンダー・音量等)、または\n"
        "         単なる文章入力(メモ・チャット文)。Web処理対象外。\n\n"
        "出力は厳密にJSONのみ。例:\n"
        '{"kind":"search","query":"AWS最新ニュース","question":null}\n'
        '{"kind":"fetch","url":"https://example.com","question":"価格はいくら?"}\n'
        '{"kind":"skip"}\n'
    )
    try:
        c = _bedrock_client()
        r = c.converse(
            modelId=BEDROCK_MODEL_ID,
            system=[{"text": sys_prompt}],
            messages=[{"role": "user", "content": [{"text": text}]}],
            inferenceConfig={"maxTokens": 200, "temperature": 0.0},
        )
        out = r["output"]["message"]["content"][0]["text"].strip()
        # JSON部分のみ抽出 (前後にmarkdownが混ざる場合の保険)
        if "```" in out:
            out = out.split("```")[1].lstrip("json").strip()
        return json.loads(out)
    except Exception as e:
        print(f"[classify] error: {e}")
        return {"kind": "skip"}


def summarize_with_claude(content: str, question: Optional[str] = None) -> str:
    c = _bedrock_client()
    if question:
        prompt = (
            f"以下のWebページ本文から、質問に簡潔に答えてください。"
            f"答えのテキストのみを返してください。\n\n"
            f"【質問】{question}\n\n【ページ本文】\n{content}"
        )
    else:
        prompt = (
            "以下のWebページ本文の要点を、日本語で3〜6行の箇条書き(各行「・」始まり)に"
            "まとめてください。要約テキストのみを返してください。\n\n"
            f"【ページ本文】\n{content}"
        )
    r = c.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": 800, "temperature": 0.2},
    )
    return r["output"]["message"]["content"][0]["text"].strip()


# ============================================================
# 処理ロジック
# ============================================================
def process_entry(entry_id: str) -> dict:
    entry = get_entry(entry_id)
    if not entry:
        return {"error": "entry not found"}

    update_entry(entry_id, {"status": "processing"})
    t0 = time.time()
    text = entry.get("text", "")

    # 1. 分類
    cls = classify_and_extract(text)
    kind = cls.get("kind", "skip")

    if kind == "skip":
        update_entry(entry_id, {
            "status": "done",
            "webResult": {"kind": "skipped",
                          "elapsedMs": int((time.time() - t0) * 1000)},
        })
        return {"ok": True, "kind": "skipped"}

    # 2. URL決定
    target_url = cls.get("url")
    if kind == "search" and not target_url:
        query = cls.get("query") or text
        target_url = _google_first_url(query)
        if not target_url:
            update_entry(entry_id, {
                "status": "error",
                "webResult": {"kind": kind, "summary": f"検索1位URLが取得できませんでした: {query}",
                              "elapsedMs": int((time.time() - t0) * 1000)},
            })
            return {"ok": False, "reason": "no url"}

    # 3. ページ取得+要約
    try:
        content = _fetch_page_text(target_url)
        if not content:
            raise RuntimeError("本文が取得できません")
        summary = summarize_with_claude(content, cls.get("question"))
        elapsed = int((time.time() - t0) * 1000)
        update_entry(entry_id, {
            "status": "done",
            "webResult": {
                "kind": kind,
                "summary": summary,
                "sourceUrl": target_url,
                "elapsedMs": elapsed,
            },
        })
        return {"ok": True, "kind": kind, "url": target_url}
    except Exception as e:
        update_entry(entry_id, {
            "status": "error",
            "webResult": {"kind": kind, "summary": f"取得・要約エラー: {e}",
                          "sourceUrl": target_url,
                          "elapsedMs": int((time.time() - t0) * 1000)},
        })
        return {"ok": False, "error": str(e)}


# ============================================================
# Vercel Python ハンドラ (BaseHTTPRequestHandler)
# ============================================================
class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: Any):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _check_auth(self) -> bool:
        if not APEX_VOICE_TOKEN:
            # トークン未設定なら本番では拒否、ローカル開発では通す
            return os.environ.get("VERCEL_ENV") != "production"
        got = self.headers.get("Authorization", "")
        bearer = got[7:].strip() if got.startswith("Bearer ") else ""
        return bearer == APEX_VOICE_TOKEN

    def do_POST(self):
        if not self._check_auth():
            self._send_json(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length > 0 else b""
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception as e:
            self._send_json(400, {"error": f"invalid json: {e}"})
            return
        entry_id = body.get("id")
        if not entry_id:
            self._send_json(400, {"error": "id is required"})
            return
        try:
            result = process_entry(entry_id)
            self._send_json(200, result)
        except Exception as e:
            self._send_json(500, {"error": str(e)})

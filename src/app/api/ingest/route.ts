/**
 * Apex Voice(macOS) からの認識テキスト受信エンドポイント
 *
 * POST /api/ingest
 *   Headers: Authorization: Bearer <APEX_VOICE_TOKEN>
 *   Body: {
 *     text: string,
 *     localResult?: { kind: "action" | "text", message?: string }
 *   }
 *
 * Response: { id: string, entry: Entry }
 *
 * 受信後は KV に保存し(status: "received")、必要なら別途 /api/process が
 * Strands Agent + AgentCore Browser で処理する。
 */
import { NextRequest, NextResponse, after } from "next/server";
import { requireToken, newEntryId } from "@/lib/auth";
import { saveEntry } from "@/lib/kv";
import type { Entry } from "@/lib/types";

export async function POST(req: NextRequest) {
  const auth = requireToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  let body: { text?: string; localResult?: Entry["localResult"] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const entry: Entry = {
    id: newEntryId(),
    receivedAt: Date.now(),
    text,
    source: "apex-voice",
    status: "received",
    localResult: body.localResult,
  };

  await saveEntry(entry);

  // レスポンス送信後に Python serverless /api/process を呼んで非同期処理
  // (Web系の発話なら検索・要約、それ以外はskip)
  after(async () => {
    try {
      const origin = req.nextUrl.origin;
      const token = process.env.APEX_VOICE_TOKEN || "";
      await fetch(`${origin}/api/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: entry.id }),
      });
    } catch (e) {
      console.error("trigger process failed:", e);
    }
  });

  return NextResponse.json({ id: entry.id, entry });
}

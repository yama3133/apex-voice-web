# Apex Voice Web

[Apex Voice (macOS)](https://github.com/yama3133/apex-voice) のクラウドコンパニオン。音声入力で発した内容と、Strands Agents + AgentCore Browser によるエージェント実行結果を、ブラウザでリアルタイムに表示する Web プラットフォーム。

## 役割分担

| 機能 | 実行場所 |
|---|---|
| macOSローカル操作（リマインダー・カレンダー・メモ・システム操作・購入承認） | Apex Voice (macOS) |
| 文字挿入（メモ帳・チャット等のカーソル位置） | Apex Voice (macOS) |
| Web検索・ページ閲覧・要約 | Apex Voice Web (Vercel + AgentCore Browser) |

Apex Voice が認識したテキストを Vercel API へ転送し、Web 系のエージェント実行結果を Web UI で確認できる構成。

## アーキテクチャ

```
[Apex Voice (macOS)]
   ↓ 認識テキストをPOST
[Vercel API (Next.js)]
   ↓ Strands Agent + AgentCore Browser
[Vercel KV] ← 履歴保存
   ↓
[Web UI (Next.js)] ← ブラウザでリアルタイム表示
```

## 開発

```bash
cd ~/apex-voice-web
npm install
npm run dev
# http://localhost:3000
```

KV/AWS の環境変数が未設定でも、メモリ内フォールバックで履歴表示は動く（プロセス再起動で消える）。

## 環境変数

| 変数 | 用途 |
|---|---|
| `APEX_VOICE_TOKEN` | Apex Voice ↔ Vercel API の共有トークン（本番必須） |
| `KV_REST_API_URL` | Vercel KV (Upstash Redis) URL |
| `KV_REST_API_TOKEN` | 同 トークン |
| `AWS_REGION` | `us-east-1`（Bedrock 用） |
| `AWS_ROLE_ARN` | OIDC連携で引き受けるロール |
| `APEXVOICE_MEMORY_ID` | AgentCore Memory ストアID（任意） |

## API

- `POST /api/ingest` — Apex Voice からの認識テキスト受信
  - Header: `Authorization: Bearer <APEX_VOICE_TOKEN>`
  - Body: `{ "text": "...", "localResult": { "kind": "action"|"text", "message": "..." } }`
- `GET /api/history?limit=50` — 履歴取得
- `POST /api/seed` — 開発用に5件のダミー履歴を投入

## デプロイ

Vercel + GitHub連携。`yama3133/apex-voice-web` を Vercel プロジェクトに紐付け、自動デプロイ。

## ライセンス
MIT

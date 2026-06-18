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
import { NextRequest, NextResponse } from "next/server";
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
  return NextResponse.json({ id: entry.id, entry });
}

/**
 * 再実行エンドポイント
 *
 * POST /api/reprocess
 *   Body: { id: string }
 *
 * 既存エントリの webResult をクリアして status を "received" に戻し、
 * /api/process を再度トリガーする。
 */
import { NextRequest, NextResponse, after } from "next/server";
import { getEntry, updateEntry } from "@/lib/kv";

export async function POST(req: NextRequest) {
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const id = body.id;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const cur = await getEntry(id);
  if (!cur) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const updated = await updateEntry(id, {
    status: "received",
    webResult: undefined,
  });

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
        body: JSON.stringify({ id }),
      });
    } catch (e) {
      console.error("trigger reprocess failed:", e);
    }
  });

  return NextResponse.json({ ok: true, entry: updated });
}

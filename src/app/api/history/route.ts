/**
 * 履歴取得エンドポイント
 *
 * GET /api/history?limit=50
 * Response: { entries: Entry[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { listEntries } from "@/lib/kv";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(100, parseInt(limitRaw, 10) || 50)) : 50;
  try {
    const entries = await listEntries(limit);
    return NextResponse.json({ entries });
  } catch (e) {
    return NextResponse.json(
      { error: String(e), entries: [] },
      { status: 500 },
    );
  }
}

/**
 * 共有トークン認証
 * Apex Voice(macOS)と Vercel API の間は環境変数 APEX_VOICE_TOKEN で守る。
 * 弱いがv1としては十分。
 */
import type { NextRequest } from "next/server";

export function requireToken(req: NextRequest): { ok: true } | { ok: false; reason: string } {
  const expected = process.env.APEX_VOICE_TOKEN;
  if (!expected) {
    // ローカル開発時はトークン未設定なら通す(警告だけ)
    if (process.env.NODE_ENV !== "production") {
      return { ok: true };
    }
    return { ok: false, reason: "APEX_VOICE_TOKEN not configured" };
  }
  const got = req.headers.get("authorization") || "";
  const bearer = got.startsWith("Bearer ") ? got.slice(7).trim() : "";
  if (bearer === expected) return { ok: true };
  return { ok: false, reason: "invalid token" };
}

export function newEntryId(): string {
  // ulid風(時刻ベース+ランダム)
  const t = Date.now().toString(36).padStart(9, "0");
  const r = Math.random().toString(36).slice(2, 10);
  return `${t}-${r}`;
}

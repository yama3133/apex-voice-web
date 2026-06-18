/**
 * Vercel KV ラッパー
 * - 履歴は `history` キーに ZSet(timestamp スコア)で保持
 * - 各エントリは `entry:<id>` キーにJSON保存
 * - 直近 MAX_HISTORY 件のみ保持(古いものは pop)
 *
 * KV未設定時はインメモリのフォールバックを使う(プロセス再起動で消える)。
 * ローカル開発用。
 */
import type { Entry } from "./types";

const ZKEY = "history:z";
const HKEY = (id: string) => `entry:${id}`;
const MAX_HISTORY = 50;

// KV 環境変数があるかチェック
const HAS_KV =
  !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

// インメモリストア(KV未設定時のフォールバック)
type MemStore = {
  entries: Map<string, Entry>;
  order: string[];   // 時系列順(新しい順)
};
const _mem: MemStore = (globalThis as unknown as {
  __apexVoiceMem?: MemStore;
}).__apexVoiceMem ||
((globalThis as unknown as { __apexVoiceMem?: MemStore }).__apexVoiceMem = {
  entries: new Map(),
  order: [],
});

async function _kv() {
  // 遅延import: KV未設定なら@vercel/kv自体読まない
  const m = await import("@vercel/kv");
  return m.kv;
}

export async function saveEntry(entry: Entry): Promise<void> {
  if (!HAS_KV) {
    _mem.entries.set(entry.id, entry);
    _mem.order.unshift(entry.id);
    if (_mem.order.length > MAX_HISTORY) {
      const removed = _mem.order.splice(MAX_HISTORY);
      for (const id of removed) _mem.entries.delete(id);
    }
    return;
  }
  const kv = await _kv();
  await kv.set(HKEY(entry.id), entry);
  await kv.zadd(ZKEY, { score: entry.receivedAt, member: entry.id });
  const total = await kv.zcard(ZKEY);
  if (total > MAX_HISTORY) {
    const remove = total - MAX_HISTORY;
    const oldIds = await kv.zrange<string[]>(ZKEY, 0, remove - 1);
    if (oldIds && oldIds.length > 0) {
      await kv.zrem(ZKEY, ...oldIds);
      for (const id of oldIds) await kv.del(HKEY(id));
    }
  }
}

export async function updateEntry(
  id: string,
  patch: Partial<Entry>,
): Promise<Entry | null> {
  if (!HAS_KV) {
    const cur = _mem.entries.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    _mem.entries.set(id, next);
    return next;
  }
  const kv = await _kv();
  const cur = (await kv.get<Entry>(HKEY(id))) ?? null;
  if (!cur) return null;
  const next = { ...cur, ...patch };
  await kv.set(HKEY(id), next);
  return next;
}

export async function listEntries(limit = 50): Promise<Entry[]> {
  if (!HAS_KV) {
    return _mem.order
      .slice(0, limit)
      .map((id) => _mem.entries.get(id))
      .filter((e): e is Entry => !!e);
  }
  const kv = await _kv();
  const ids = await kv.zrange<string[]>(ZKEY, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const items: Entry[] = [];
  for (const id of ids) {
    const e = await kv.get<Entry>(HKEY(id));
    if (e) items.push(e);
  }
  return items;
}

export async function getEntry(id: string): Promise<Entry | null> {
  if (!HAS_KV) return _mem.entries.get(id) ?? null;
  const kv = await _kv();
  return (await kv.get<Entry>(HKEY(id))) ?? null;
}

export async function clearAll(): Promise<void> {
  if (!HAS_KV) {
    _mem.entries.clear();
    _mem.order.length = 0;
    return;
  }
  const kv = await _kv();
  const ids = await kv.zrange<string[]>(ZKEY, 0, -1);
  if (ids && ids.length > 0) {
    for (const id of ids) await kv.del(HKEY(id));
    await kv.del(ZKEY);
  }
}

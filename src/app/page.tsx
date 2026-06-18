"use client";

import { useEffect, useState, useCallback } from "react";
import type { Entry } from "@/lib/types";

const POLL_INTERVAL_MS = 2000;

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/history?limit=50", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setEntries(data.entries || []);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchHistory();
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchHistory]);

  const reprocess = useCallback(
    async (id: string) => {
      try {
        await fetch("/api/reprocess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        await fetchHistory();
      } catch {
        // ignore
      }
    },
    [fetchHistory],
  );

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800 sticky top-0 bg-white/80 dark:bg-neutral-950/80 backdrop-blur z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎙️</span>
            <h1 className="text-xl font-bold">Apex Voice Web</h1>
          </div>
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              リアルタイム
            </span>
            <span>{loaded ? `${entries.length}件` : "読込中…"}</span>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
            読み込みエラー: {error}
          </div>
        )}

        {loaded && entries.length === 0 && <EmptyState />}

        <ul className="space-y-3">
          {entries.map((e) => (
            <EntryCard key={e.id} entry={e} onReprocess={reprocess} />
          ))}
        </ul>
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 text-neutral-500">
      <div className="text-5xl mb-3">📭</div>
      <div className="font-medium">まだ履歴がありません</div>
      <div className="text-xs mt-2 leading-relaxed">
        Apex Voice (macOS) の <span className="font-mono">Web連携モード</span> を ON にして話してみてください。
        <br />
        テスト用に <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800">
          curl -X POST /api/seed
        </code> でダミーデータを投入できます。
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  onReprocess,
}: {
  entry: Entry;
  onReprocess: (id: string) => void;
}) {
  const date = new Date(entry.receivedAt);
  const timeStr = date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateStr = date.toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
  });

  return (
    <li className="rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs text-neutral-500">
          {dateStr} {timeStr}
        </div>
        <StatusBadge status={entry.status} />
      </div>

      <div className="text-base leading-relaxed">{entry.text}</div>

      {/* macOSローカル実行結果 (アクションのみ表示、kind=textは非表示) */}
      {entry.localResult?.kind === "action" && entry.localResult.message && (
        <div className="mt-3 px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-sm">
          <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">
            🖥️ macOS ローカル実行
          </div>
          <div>{entry.localResult.message}</div>
        </div>
      )}

      {/* Web実行結果 */}
      {entry.webResult && entry.webResult.kind !== "skipped" && (
        <div className="mt-3 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-sm">
          <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-1 flex items-center gap-2">
            <span>🌐 Web実行 ({entry.webResult.kind})</span>
            {entry.webResult.elapsedMs && (
              <span className="font-normal text-emerald-600 dark:text-emerald-400">
                {(entry.webResult.elapsedMs / 1000).toFixed(1)}秒
              </span>
            )}
          </div>
          {entry.webResult.summary && (
            <div className="whitespace-pre-wrap">{entry.webResult.summary}</div>
          )}
          {entry.webResult.sourceUrl && (
            <a
              href={entry.webResult.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-2 text-xs text-emerald-700 dark:text-emerald-400 underline truncate max-w-full"
            >
              元ページを開く →
            </a>
          )}
        </div>
      )}

      {/* 処理中スピナー */}
      {(entry.status === "received" || entry.status === "processing") && (
        <div className="mt-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-sm flex items-center gap-2">
          <Spinner />
          <span className="text-amber-700 dark:text-amber-300">
            {entry.status === "received" ? "受信済み・処理待ち" : "Web判定・取得中…"}
          </span>
        </div>
      )}

      {/* エラー時 / 再実行ボタン */}
      {entry.status !== "received" && entry.status !== "processing" && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <button
            onClick={() => onReprocess(entry.id)}
            className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 underline-offset-2 hover:underline transition"
          >
            再実行
          </button>
        </div>
      )}
    </li>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-amber-300 border-t-amber-700 dark:border-amber-700 dark:border-t-amber-300 animate-spin" />
  );
}

function StatusBadge({ status }: { status: Entry["status"] }) {
  const map: Record<Entry["status"], { label: string; cls: string }> = {
    received: {
      label: "受信",
      cls: "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300",
    },
    processing: {
      label: "処理中",
      cls: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    },
    done: {
      label: "完了",
      cls: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    },
    error: {
      label: "エラー",
      cls: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    },
  };
  const { label, cls } = map[status];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {label}
    </span>
  );
}

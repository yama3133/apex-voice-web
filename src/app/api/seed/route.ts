/**
 * 開発用シード: ダミー履歴を5件投入
 * POST /api/seed
 */
import { NextResponse } from "next/server";
import { saveEntry } from "@/lib/kv";
import { newEntryId } from "@/lib/auth";
import type { Entry } from "@/lib/types";

export async function POST() {
  const now = Date.now();
  const samples: Omit<Entry, "id" | "receivedAt">[] = [
    {
      text: "明日10時に田中さんと打ち合わせをカレンダーに入れて",
      source: "apex-voice",
      status: "done",
      localResult: {
        kind: "action",
        message: "予定追加: 「田中さんと打ち合わせ」06/20 10:00〜",
      },
    },
    {
      text: "AWSの最新リリースニュース調べて",
      source: "apex-voice",
      status: "done",
      webResult: {
        kind: "search",
        summary:
          "・S3 Table のクエリ性能改善 (2026-06-18)\n・Bedrock AgentCore Hosting がGA (2026-06-17)\n・Lambda の最大メモリが20GBに拡張 (2026-06-15)",
        sourceUrl: "https://aws.amazon.com/new/",
        elapsedMs: 6300,
      },
    },
    {
      text: "今日の天気を教えて",
      source: "apex-voice",
      status: "done",
      webResult: {
        kind: "search",
        summary: "東京: 晴れ時々曇り、最高28°C / 最低22°C、降水確率10%",
        sourceUrl: "https://weather.yahoo.co.jp/weather/jp/13/4410.html",
        elapsedMs: 4100,
      },
    },
    {
      text: "音量上げて、それと画面を暗くして",
      source: "apex-voice",
      status: "done",
      localResult: {
        kind: "action",
        message: "音量を上げました / 画面を暗くしました",
      },
    },
    {
      text: "こんにちは、これはテストです",
      source: "apex-voice",
      status: "done",
      localResult: { kind: "text" },
    },
  ];

  let i = 0;
  for (const s of samples) {
    const entry: Entry = {
      id: newEntryId(),
      // 古いもの順に少しずらして並べる
      receivedAt: now - (samples.length - i) * 30 * 1000,
      ...s,
    };
    await saveEntry(entry);
    i++;
  }
  return NextResponse.json({ ok: true, inserted: samples.length });
}

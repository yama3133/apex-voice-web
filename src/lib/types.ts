/**
 * Apex Voice Web - 共通型定義
 */

export type EntryStatus =
  | "received"        // Apex Voice から受信したばかり
  | "processing"      // Strands agent 実行中
  | "done"            // 完了
  | "error";

export interface Entry {
  id: string;                    // ulid 等
  receivedAt: number;            // unix ms
  text: string;                  // 認識テキスト
  source: "apex-voice" | "web";  // どこから来たか
  status: EntryStatus;
  // Apex Voice 側が既にローカル実行した結果(任意)
  localResult?: {
    kind: "action" | "text";
    message?: string;            // アクションの場合のメッセージ
  };
  // Vercel エージェントが処理した結果(任意)
  webResult?: {
    kind: "search" | "fetch" | "text" | "skipped";
    summary?: string;            // 表示用テキスト
    sourceUrl?: string;          // 元ページURL
    screenshotUrl?: string;      // スクショ画像(将来)
    elapsedMs?: number;
  };
}

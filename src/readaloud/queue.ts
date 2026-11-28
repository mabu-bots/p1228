// ==========================================
// 📥 読み上げキュー（Guild ごとの直列処理）
// ==========================================
// 📥 再生待ちの文章を FIFO で保持し、1件ずつ直列に処理する
// （旧 Worker の pumpQueue と同じ意味）。
// 上限は50件で、超過した追加はエラーにする。1件の処理失敗は
// その件だけで分離し、後続の再生を止めない。セッションが
// 消えた場合は isActive が false を返し、残りを打ち切る。
// Discord / 音声への依存は processItem コールバックに閉じる。

import type { ReadAloudSettings } from "./settings.js";

// ------------------------------------------
// 📥 キュー項目
// ------------------------------------------

export interface SpeechQueueItem {
  // 🔊 読み上げる文章（整形済み）
  text: string;
  // 🔊 投稿者 / 実行者のユーザー ID（設定・辞書の User スコープ用）
  userId?: string;
  // 🔊 設定の一部をその場で上書きする場合に使う（通常は未指定）
  settingsOverride?: Partial<ReadAloudSettings>;
}

// 🔢 キューの上限件数（旧実装と同じ50件）。
export const SPEECH_QUEUE_LIMIT = 50;

export interface SpeechQueueOptions {
  // 🔊 1件を処理する（合成 → 再生まで）。失敗は例外で知らせる
  processItem: (item: SpeechQueueItem) => Promise<void>;
  // 📝 項目の失敗時の通知（ログ用）。未指定なら握りつぶす
  onItemError?: (error: unknown, item: SpeechQueueItem) => void;
  // 🛑 セッションが生きているかの確認。false になったら残りを打ち切る
  isActive?: () => boolean;
}

// ------------------------------------------
// 📥 キュー本体
// ------------------------------------------

export class SpeechQueue {
  // 📥 処理待ちの項目（処理中の1件は含まない。旧実装の数え方と同じ）
  private items: SpeechQueueItem[] = [];
  // 🔄 ポンプが動いているか
  private processing = false;
  // 🔄 clear のたびに進める世代番号。古いポンプの継続を防ぐ
  private generation = 0;

  constructor(private readonly options: SpeechQueueOptions) {}

  // 🔢 処理待ちの件数
  get size(): number {
    return this.items.length;
  }

  // 📥 項目を追加する。上限到達時は旧実装と同じ文言で例外にする。
  enqueue(item: SpeechQueueItem): void {
    if (this.items.length >= SPEECH_QUEUE_LIMIT) {
      throw new Error(`読み上げキューが上限（${SPEECH_QUEUE_LIMIT}件）に達しています。`);
    }
    this.items.push(item);
    void this.pump();
  }

  // 🧹 待ち項目を全て破棄する（退出時）。処理中の1件は止めない
  // （再生停止はプレイヤー側の責務）。
  clear(): void {
    this.items.length = 0;
    this.generation += 1;
  }

  // 🔄 直列ポンプ。複数回呼ばれても実働は1つだけ。
  private async pump(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    const generation = this.generation;
    try {
      while (this.items.length > 0 && generation === this.generation) {
        if (this.options.isActive && !this.options.isActive()) break;
        const item = this.items.shift();
        if (!item) continue;
        try {
          await this.options.processItem(item);
        } catch (error) {
          // 🧩 失敗は項目ごとに分離する: 1件の失敗で後ろの再生全体を
          // 止めない（旧実装と同じ方針）。
          this.options.onItemError?.(error, item);
          if (this.options.isActive && !this.options.isActive()) break;
        }
      }
    } finally {
      this.processing = false;
      // 🔄 処理中に追加されていたら回し直す。
      if (this.items.length > 0 && generation === this.generation) void this.pump();
    }
  }
}

// ==========================================
// 🎮 プレゼンス・サイクル（3 Bot 共通）
// ==========================================
// 🎮 Playing（type 0）で1分ごとに次の2パターンを交互に表示する
// （数値仕様の正は DESIGN §3.2。旧実装 gateway_worker.go の移植）。
//   パターンA: <表示名> | <watching文> <経過時間>
//              例: 星燈 | サーバーを見守り中 1時間26分
//   パターンB: <表示名> | 現在時刻 HH:MM JST
//              例: 言ノ葉 | 現在時刻 18:10 JST
// 値は「次の分の境界時点」のものを計算し、境界の 200ms 前に先行送信
// する（Discord のプレゼンス伝播遅延の実測 中央値190ms / p95 208ms と
// 相殺し、切り替えが境界にほぼ一致するようにする。実測の着地は境界の
// ±20ms 以内）。位相は Unix 分の偶奇で決まるため、全 Bot が同時に
// 切り替わる。秒粒度の更新はしない（伝播は約20秒に5回が上限で、
// 秒更新の配信率は実測23%だったため）。
//
// 📌 経過時間の起点はその Bot の READY 時刻。切断で破棄し次回 READY
// で数え直し、RESUMED では保持する。
// ⚠️ 障害時は Watching（type 3）の障害表示をローテーションより優先
// し、ローテーションを止める（旧実装の優先順位をそのまま維持）。
// ⚠️ 送信予定時刻を過ぎていたら翌分の境界へ前進させる。この前進が
// 無いと即時発火の連打になり、Gateway レート制限（close 4008）で
// 全 Bot が切断する事故になる（旧実装の初版で実際に起きた）。

import { ActivityType } from "discord.js";
import { logger } from "./logger.js";

// ------------------------------------------
// 🎮 定数
// ------------------------------------------

// ⏱️ 境界より前に送信するリード時間（ms）
export const PRESENCE_SEND_LEAD_MS = 200;

// 🚨 障害時に表示する文言（旧実装と同一）
export const PRESENCE_FAILURE_TEXT = "障害対応中：Worker応答なし";

// 🎮 送信するプレゼンス1件分（discord.js の Client から切り離し、
// テストでは送信関数を差し替えて検証する）
export interface PresenceActivity {
  // 📌 アクティビティ名（表示文字列）
  name: string;
  // 📌 種別（通常時 Playing / 障害時 Watching）
  type: ActivityType;
}

// ------------------------------------------
// 🧮 純粋関数（時刻計算）
// ------------------------------------------

// ⏱️ 経過時間を分粒度で整形する（1時間26分 / 26分 / 0分）
export function formatElapsedMinutes(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? `${hours}時間${String(minutes).padStart(2, "0")}分`
    : `${minutes}分`;
}

// 🎮 時刻 atMs の位相を返す（Unix 分の偶奇。0=経過時間 / 1=現在時刻）
export function presencePhase(atMs: number): 0 | 1 {
  return (Math.floor(atMs / 60_000) % 2) as 0 | 1;
}

// 🎮 時刻 atMs におけるパターン文字列を返す。経過時間の起点が未確定
// （null）なら atMs 自身を起点とみなす（旧実装の readyAt zero 扱いと
// 同じで、表示は 0分 になる）。
export function presenceCycleText(
  displayName: string,
  watching: string,
  startedAtMs: number | null,
  atMs: number,
): string {
  if (presencePhase(atMs) === 1) {
    const jst = new Date(atMs + 9 * 3_600_000);
    const hh = String(jst.getUTCHours()).padStart(2, "0");
    const mm = String(jst.getUTCMinutes()).padStart(2, "0");
    return `${displayName} | 現在時刻 ${hh}:${mm} JST`;
  }
  const start = startedAtMs ?? atMs;
  return `${displayName} | ${watching} ${formatElapsedMinutes(atMs - start)}`;
}

// ⏰ 次の分の境界と、その値で先行送信すべき時刻を返す。送信予定時刻
// を過ぎている場合は翌分の境界へ前進する（必須の前進処理。上の ⚠️ 参照）。
export function nextPresenceSend(nowMs: number): {
  sendAt: number;
  boundary: number;
} {
  let boundary = Math.floor(nowMs / 60_000) * 60_000 + 60_000;
  let sendAt = boundary - PRESENCE_SEND_LEAD_MS;
  if (sendAt <= nowMs) {
    boundary += 60_000;
    sendAt = boundary - PRESENCE_SEND_LEAD_MS;
  }
  return { sendAt, boundary };
}

// ------------------------------------------
// 🕐 時計（テストで差し替え可能にする）
// ------------------------------------------

// 🕐 PresenceCycle が使う時計とタイマーの抽象。既定は実時計で、
// タイマーは unref してプロセス終了を妨げないようにする。
export interface PresenceClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: PresenceClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return timer;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

// ------------------------------------------
// 🎮 プレゼンス・サイクル本体
// ------------------------------------------

export interface PresenceCycleOptions {
  // 📌 表示名（星燈 / 言ノ葉 / 紡言）
  displayName: string;
  // 📌 パターンAの watching 文
  watching: string;
  // 📡 送信関数（Bot 側で client.user.setActivity へつなぐ）
  send: (activity: PresenceActivity) => void;
  // 🕐 時計（省略時は実時計。テストで差し替える）
  clock?: PresenceClock;
}

// 🎮 1 Bot 分のプレゼンス状態機械。READY / RESUMED / 切断 / 障害の
// イベントを Bot 側の接続イベントから受け取り、境界アラインの送信
// スケジュールを回す。状態は Bot ごとに独立（インスタンスを分ける）。
export class PresenceCycle {
  private readonly displayName: string;
  private readonly watching: string;
  private readonly send: (activity: PresenceActivity) => void;
  private readonly clock: PresenceClock;
  // ⏱️ 経過時間の起点（READY 時刻。未接続・切断後は null）
  private startedAtMs: number | null = null;
  // 🔌 接続中かどうか（READY〜切断の間だけ true）
  private connected = false;
  // 🚨 障害表示中かどうか（ローテーションより優先）
  private failed = false;
  // ⏰ 境界送信用タイマー（1本だけ）
  private timer: unknown = null;

  constructor(options: PresenceCycleOptions) {
    this.displayName = options.displayName;
    this.watching = options.watching;
    this.send = options.send;
    this.clock = options.clock ?? realClock;
  }

  // 📌 現在の表示文字列（障害時は障害文言）。参照用。
  currentActivity(atMs: number = this.clock.now()): PresenceActivity {
    if (this.failed) {
      return { name: PRESENCE_FAILURE_TEXT, type: ActivityType.Watching };
    }
    return {
      name: presenceCycleText(this.displayName, this.watching, this.startedAtMs, atMs),
      type: ActivityType.Playing,
    };
  }

  // 🚀 READY: 経過時間の起点を今に固定し、現在値を即時適用して
  // ローテーションを開始する。再接続で新しい READY が来たら数え直し。
  markReady(): void {
    this.startedAtMs = this.clock.now();
    this.connected = true;
    this.applyNow();
    this.schedule();
  }

  // 🔄 RESUMED: 起点は保持する。起点が無い場合だけ今を起点にする
  // （旧実装 markBotReady の RESUMED 扱いと同じ）。
  markResumed(): void {
    if (this.startedAtMs === null) this.startedAtMs = this.clock.now();
    this.connected = true;
    this.applyNow();
    this.schedule();
  }

  // 🔌 切断: 起点を破棄し、タイマーを止める（次回 READY で数え直し）。
  markDisconnected(): void {
    this.startedAtMs = null;
    this.connected = false;
    this.clearTimer();
  }

  // 🚨 障害状態の設定。障害表示はローテーションより優先し、表示中は
  // 境界送信を止める。復旧したら現在値で即時適用し、ローテーション
  // へ戻る。状態が変わらない呼び出しでは何もしない。
  setFailed(failed: boolean): void {
    if (this.failed === failed) return;
    this.failed = failed;
    if (!this.connected) return;
    this.applyNow();
    if (failed) {
      this.clearTimer();
    } else {
      this.schedule();
    }
  }

  // 🛑 全て止める（プロセス終了時用）。
  stop(): void {
    this.connected = false;
    this.clearTimer();
  }

  // 📡 現在値（または障害表示）を即時に送信する。
  private applyNow(): void {
    this.deliver(this.currentActivity());
  }

  // 📡 境界時点の値で送信する（先行送信。値は送信時刻ではなく
  // 境界のものを使う）。
  private applyAt(boundaryMs: number): void {
    this.deliver(this.currentActivity(boundaryMs));
  }

  private deliver(activity: PresenceActivity): void {
    try {
      this.send(activity);
      logger.info("presence_update_sent", {
        activity: activity.name,
        activity_type: activity.type,
      });
    } catch (error) {
      logger.error("presence_update_failed", {
        activity: activity.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ⏰ 次の境界への先行送信を予約する。多重予約は1本に保つ。
  private schedule(): void {
    this.clearTimer();
    if (!this.connected || this.failed) return;
    const { sendAt, boundary } = nextPresenceSend(this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      // 📌 値は境界時点のものを使う（先行送信）
      this.applyAt(boundary);
      this.schedule();
    }, Math.max(0, sendAt - this.clock.now()));
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

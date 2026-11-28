// ==========================================
// 🧪 プレゼンス・サイクルのテスト
// ==========================================
// 🧪 境界アラインの検証が中心。FakeClock でタイマーをモックし、
// 「送信が分の境界の 200ms 前に、その境界時点の値で」行われること、
// 障害表示の優先、READY / RESUMED / 切断での起点の扱いを確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityType } from "discord.js";
import {
  formatElapsedMinutes,
  nextPresenceSend,
  presenceCycleText,
  PRESENCE_FAILURE_TEXT,
  PRESENCE_SEND_LEAD_MS,
  PresenceCycle,
  type PresenceActivity,
  type PresenceClock,
} from "../src/presence.js";

// ------------------------------------------
// 🕐 テスト用時計（タイマーを手動で進める）
// ------------------------------------------
class FakeClock implements PresenceClock {
  private current: number;
  private timers = new Map<number, { fireAt: number; fn: () => void }>();
  private nextId = 1;

  constructor(start: number) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { fireAt: this.current + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  // ⏩ 時刻を進め、到来したタイマーを発火順に実行する
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.fireAt <= target && t.fireAt < dueAt) {
          dueAt = t.fireAt;
          dueId = id;
        }
      }
      if (dueId === null) break;
      const timer = this.timers.get(dueId)!;
      this.timers.delete(dueId);
      this.current = timer.fireAt;
      timer.fn();
    }
    this.current = target;
  }
}

// 📡 送信を記録する受け口（送信時刻は FakeClock の現在時刻）
interface SentRecord {
  at: number;
  activity: PresenceActivity;
}

function recorder(clock: FakeClock): { sent: SentRecord[]; send: (a: PresenceActivity) => void } {
  const sent: SentRecord[] = [];
  return {
    sent,
    send: (activity) => {
      sent.push({ at: clock.now(), activity });
    },
  };
}

const MIN = 60_000;

// ------------------------------------------
// 🧮 純粋関数
// ------------------------------------------

test("formatElapsedMinutes: formats minutes only under an hour", () => {
  assert.equal(formatElapsedMinutes(0), "0分");
  assert.equal(formatElapsedMinutes(59_000), "0分");
  assert.equal(formatElapsedMinutes(26 * MIN), "26分");
});

test("formatElapsedMinutes: hours with zero-padded minutes, negatives clamped", () => {
  assert.equal(formatElapsedMinutes((1 * 60 + 26) * MIN + 33_000), "1時間26分");
  assert.equal(formatElapsedMinutes(26 * 3_600_000 + 3 * MIN), "26時間03分");
  assert.equal(formatElapsedMinutes(-MIN), "0分");
});

test("presenceCycleText: even Unix minutes show elapsed with the watching phrase", () => {
  // Unix 0 分は偶数位相 = 経過時間。経過 1時間26分33秒 → 1時間26分。
  const at = (1 * 60 + 26) * MIN + 33_000;
  assert.equal(
    presenceCycleText("星燈", "サーバーを見守り中", 0, at),
    "星燈 | サーバーを見守り中 1時間26分",
  );
});

test("presenceCycleText: odd Unix minutes show the JST clock", () => {
  // Unix 61 分 = 奇数位相。UTC 01:01 → JST 10:01。
  assert.equal(
    presenceCycleText("言ノ葉", "言葉を紡ぎ中", 0, 61 * MIN),
    "言ノ葉 | 現在時刻 10:01 JST",
  );
});

test("presenceCycleText: a null start falls back to the current time (0分)", () => {
  assert.equal(
    presenceCycleText("紡言", "声をお届け中", null, 2 * MIN),
    "紡言 | 声をお届け中 0分",
  );
});

test("nextPresenceSend: leads the next boundary by PRESENCE_SEND_LEAD_MS", () => {
  const { sendAt, boundary } = nextPresenceSend(90_000); // 00:01:30
  assert.equal(boundary, 120_000);
  assert.equal(sendAt, 120_000 - PRESENCE_SEND_LEAD_MS);
});

test("nextPresenceSend: advances a whole minute when the lead has already passed", () => {
  // ⚠️ 境界まで 200ms を切っている場合は翌分へ前進する（即時発火の
  // 連打による Gateway レート制限事故の再発防止）。
  const { sendAt, boundary } = nextPresenceSend(119_900); // 00:01:59.900
  assert.equal(boundary, 180_000);
  assert.equal(sendAt, 180_000 - PRESENCE_SEND_LEAD_MS);
});

// ------------------------------------------
// 🎮 境界アライン（本体）
// ------------------------------------------

test("cycle: sends the boundary value exactly 200ms before each minute boundary", () => {
  const clock = new FakeClock(30_000); // 00:00:30（偶数位相）
  const { sent, send } = recorder(clock);
  const cycle = new PresenceCycle({
    displayName: "星燈",
    watching: "サーバーを見守り中",
    send,
    clock,
  });

  cycle.markReady();
  // 🚀 READY 直後は現在値を即時適用する
  assert.equal(sent.length, 1);
  assert.equal(sent[0].at, 30_000);
  assert.deepEqual(sent[0].activity, {
    name: "星燈 | サーバーを見守り中 0分",
    type: ActivityType.Playing,
  });

  // ⏩ 境界の 200ms 前までは追加送信しない
  clock.advance(29_799); // → 00:00:59.799
  assert.equal(sent.length, 1);

  // ⏩ 境界 60_000 の 200ms 前に、その境界時点の値（奇数位相=現在時刻）
  clock.advance(1); // → 00:00:59.800
  assert.equal(sent.length, 2);
  assert.equal(sent[1].at, 60_000 - PRESENCE_SEND_LEAD_MS);
  assert.deepEqual(sent[1].activity, {
    name: "星燈 | 現在時刻 09:01 JST",
    type: ActivityType.Playing,
  });

  // ⏩ 次の境界 120_000 でも同じく 200ms 前に偶数位相（経過時間）の値
  clock.advance(MIN);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].at, 120_000 - PRESENCE_SEND_LEAD_MS);
  assert.deepEqual(sent[2].activity, {
    name: "星燈 | サーバーを見守り中 1分",
    type: ActivityType.Playing,
  });
});

test("cycle: exactly one send per minute over a long run (no per-second updates)", () => {
  const clock = new FakeClock(30_000);
  const { sent, send } = recorder(clock);
  const cycle = new PresenceCycle({
    displayName: "言ノ葉",
    watching: "言葉を紡ぎ中",
    send,
    clock,
  });
  cycle.markReady();
  clock.advance(10 * MIN);
  // 即時適用 1 回 + 10 分ぶんの境界送信 10 回だけ。全ての境界送信が
  // 「境界 - 200ms」に一致すること（着地アラインの要）。
  assert.equal(sent.length, 11);
  for (const record of sent.slice(1)) {
    assert.equal((record.at + PRESENCE_SEND_LEAD_MS) % MIN, 0);
    assert.equal(record.activity.type, ActivityType.Playing);
  }
});

test("cycle: all bots flip phase together regardless of their READY times", () => {
  const clock = new FakeClock(30_000);
  const a = recorder(clock);
  const b = recorder(clock);
  const cycleA = new PresenceCycle({
    displayName: "星燈",
    watching: "サーバーを見守り中",
    send: a.send,
    clock,
  });
  const cycleB = new PresenceCycle({
    displayName: "紡言",
    watching: "声をお届け中",
    send: b.send,
    clock,
  });
  cycleA.markReady(); // 起点 00:00:30
  clock.advance(45_000); // → 00:01:15（この間に A は境界 60_000 分を送信済み）
  cycleB.markReady(); // 起点 00:01:15
  clock.advance(44_800); // → 00:01:59.800（境界 120_000 の先行送信）
  const lastA = a.sent[a.sent.length - 1];
  const lastB = b.sent[b.sent.length - 1];
  // 📌 同じ境界では同じ位相（偶数=経過時間）。経過の値だけ起点差ぶん違う。
  assert.equal(lastA.at, 120_000 - PRESENCE_SEND_LEAD_MS);
  assert.equal(lastB.at, 120_000 - PRESENCE_SEND_LEAD_MS);
  assert.equal(lastA.activity.name, "星燈 | サーバーを見守り中 1分");
  assert.equal(lastB.activity.name, "紡言 | 声をお届け中 0分");
});

// ------------------------------------------
// 🚨 障害表示の優先
// ------------------------------------------

test("cycle: failure display overrides the rotation and stops boundary sends", () => {
  const clock = new FakeClock(30_000);
  const { sent, send } = recorder(clock);
  const cycle = new PresenceCycle({
    displayName: "星燈",
    watching: "サーバーを見守り中",
    send,
    clock,
  });
  cycle.markReady();
  clock.advance(30_500); // → 00:01:00.500（境界送信1回あり）
  const beforeFailure = sent.length;

  cycle.setFailed(true);
  assert.equal(sent.length, beforeFailure + 1);
  assert.deepEqual(sent[sent.length - 1].activity, {
    name: PRESENCE_FAILURE_TEXT,
    type: ActivityType.Watching,
  });

  // ⏩ 障害表示中は分の境界を跨いでもローテーション送信をしない
  clock.advance(3 * MIN);
  assert.equal(sent.length, beforeFailure + 1);

  // 🔄 復旧したら現在値で即時適用し、境界送信が再開する
  cycle.setFailed(false);
  assert.equal(sent.length, beforeFailure + 2);
  assert.equal(sent[sent.length - 1].activity.type, ActivityType.Playing);
  clock.advance(MIN);
  assert.equal(sent.length, beforeFailure + 3);
  assert.equal(
    (sent[sent.length - 1].at + PRESENCE_SEND_LEAD_MS) % MIN,
    0,
  );
});

test("cycle: setFailed with the same state does not resend", () => {
  const clock = new FakeClock(30_000);
  const { sent, send } = recorder(clock);
  const cycle = new PresenceCycle({
    displayName: "星燈",
    watching: "サーバーを見守り中",
    send,
    clock,
  });
  cycle.markReady();
  cycle.setFailed(false); // 変化なし
  assert.equal(sent.length, 1);
  cycle.setFailed(true);
  cycle.setFailed(true); // 変化なし
  assert.equal(sent.length, 2);
});

// ------------------------------------------
// 🔌 READY / RESUMED / 切断と起点
// ------------------------------------------

test("cycle: disconnect discards the start; the next READY recounts elapsed", () => {
  const clock = new FakeClock(30_000);
  const { sent, send } = recorder(clock);
  const cycle = new PresenceCycle({
    displayName: "星燈",
    watching: "サーバーを見守り中",
    send,
    clock,
  });
  cycle.markReady();
  clock.advance(2 * MIN); // → 00:02:30
  cycle.markDisconnected();
  const atDisconnect = sent.length;

  // ⏩ 切断中は送信しない
  clock.advance(5 * MIN); // → 00:07:30
  assert.equal(sent.length, atDisconnect);

  // 🚀 再 READY で起点は数え直し（境界 480_000 の値が 0分 になる）
  cycle.markReady();
  clock.advance(29_800); // → 00:07:59.800
  const last = sent[sent.length - 1];
  assert.equal(last.at, 480_000 - PRESENCE_SEND_LEAD_MS);
  assert.equal(last.activity.name, "星燈 | サーバーを見守り中 0分");
});

test("cycle: RESUMED keeps the original start", () => {
  const clock = new FakeClock(30_000);
  const { sent, send } = recorder(clock);
  const cycle = new PresenceCycle({
    displayName: "星燈",
    watching: "サーバーを見守り中",
    send,
    clock,
  });
  cycle.markReady();
  clock.advance(90_000); // → 00:02:00
  // 🔄 RESUMED（起点は保持される）→ 現在値を即時適用する
  cycle.markResumed();
  const resumed = sent[sent.length - 1];
  assert.equal(resumed.at, 120_000);
  // 偶数位相で、起点 00:00:30 からの経過は 1分30秒 → 1分
  assert.equal(resumed.activity.name, "星燈 | サーバーを見守り中 1分");
});

test("cycle: RESUMED without a start uses the resume time as the start", () => {
  const clock = new FakeClock(120_000); // 偶数位相
  const { sent, send } = recorder(clock);
  const cycle = new PresenceCycle({
    displayName: "星燈",
    watching: "サーバーを見守り中",
    send,
    clock,
  });
  cycle.markResumed();
  assert.equal(sent[0].activity.name, "星燈 | サーバーを見守り中 0分");
});

test("cycle: nothing is sent before the first READY", () => {
  const clock = new FakeClock(30_000);
  const { sent, send } = recorder(clock);
  const cycle = new PresenceCycle({
    displayName: "星燈",
    watching: "サーバーを見守り中",
    send,
    clock,
  });
  clock.advance(3 * MIN);
  assert.equal(sent.length, 0);
  cycle.stop();
});

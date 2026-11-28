// ==========================================
// 🎮 ポイント・おみくじ・抽選のアクセサ
// ==========================================
// 🎮 point_accounts / point_ledger / omikuji_draws /
// star_feature_actions の読み書き。旧実装（Go の star_features.go）
// の取引（報酬・抽選・おみくじ）を意味そのままに移したもの。
// 冪等性は旧実装と同じく event_key（point_ledger）と
// star_feature_actions の保存結果で担保する。

import type { DbContext } from "./context.js";
import { formatUtcTimestamp } from "./context.js";
import type {
  OmikujiDrawRow,
  PointAccountRow,
  PointLedgerRow,
  StarFeatureActionRow,
} from "./rows.js";

export interface PointResult {
  balance: number;
  earned: number;
}

// ------------------------------------------
// 💰 ポイント口座と台帳（素の読み書き）
// ------------------------------------------

// 💰 口座行を取得する（無ければ null）。
export function getPointAccountRow(
  ctx: DbContext,
  guildId: string,
  userId: string,
): PointAccountRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM point_accounts WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId) as PointAccountRow | undefined) ?? null
  );
}

// 💰 残高だけを取得する。口座が無い場合は 0（旧 GetPointAccount 相当）。
export function getPointBalance(ctx: DbContext, guildId: string, userId: string): number {
  const row = ctx.db
    .prepare("SELECT balance FROM point_accounts WHERE guild_id = ? AND user_id = ?")
    .get(guildId, userId) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

// 💰 ギルドの全口座を返す。
export function listPointAccounts(ctx: DbContext, guildId: string): PointAccountRow[] {
  return ctx.db
    .prepare("SELECT * FROM point_accounts WHERE guild_id = ? ORDER BY user_id")
    .all(guildId) as PointAccountRow[];
}

// 💰 台帳を新しい順に返す（件数指定可）。
export function listPointLedger(
  ctx: DbContext,
  guildId: string,
  userId: string,
  limit = 100,
): PointLedgerRow[] {
  return ctx.db
    .prepare(
      "SELECT * FROM point_ledger WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, transaction_id DESC LIMIT ?",
    )
    .all(guildId, userId, limit) as PointLedgerRow[];
}

// 💰 event_key で台帳を1件取得する（冪等性の確認用。無ければ null）。
export function getPointLedgerByEventKey(
  ctx: DbContext,
  eventKey: string,
): PointLedgerRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM point_ledger WHERE event_key = ?")
      .get(eventKey) as PointLedgerRow | undefined) ?? null
  );
}

// ------------------------------------------
// ⭐ 機能アクションの冪等性（star_feature_actions）
// ------------------------------------------

// ⭐ 保存済みの処理結果を取得する（無ければ null）。
export function getStarFeatureAction(
  ctx: DbContext,
  eventKey: string,
): StarFeatureActionRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM star_feature_actions WHERE event_key = ?")
      .get(eventKey) as StarFeatureActionRow | undefined) ?? null
  );
}

// ⭐ 処理結果を保存する。
export function putStarFeatureAction(ctx: DbContext, eventKey: string, resultJson: string): void {
  ctx.db
    .prepare(
      "INSERT INTO star_feature_actions(event_key, result_json, created_at) VALUES(?, ?, ?)",
    )
    .run(eventKey, resultJson, ctx.now());
}

// ------------------------------------------
// 💰 メッセージ報酬（旧 EarnPoints 相当）
// ------------------------------------------

// 💰 報酬を付与する。クールダウン・UTC 日次上限・event の冪等性を
// 旧実装と同じ条件で判定し、付与できなければ残高だけを返す。
export function earnPoints(
  ctx: DbContext,
  args: {
    guildId: string;
    userId: string;
    eventId: string;
    points: number;
    cooldownSeconds: number;
    dailyLimit: number;
  },
): PointResult {
  const { guildId, userId, eventId, cooldownSeconds, dailyLimit } = args;
  let { points } = args;
  if (
    guildId === "" ||
    userId === "" ||
    eventId === "" ||
    points < 1 ||
    cooldownSeconds < 0 ||
    dailyLimit < 1
  ) {
    throw new Error("invalid point earning parameters");
  }
  const run = ctx.db.transaction((): PointResult => {
    const current = ctx.nowDate();
    const date = formatUtcTimestamp(current).slice(0, 10);
    const existing = getPointAccountRow(ctx, guildId, userId);
    let balance = existing?.balance ?? 0;
    let earnedToday = existing?.earned_today ?? 0;
    const earnedDate = existing?.earned_date ?? date;
    const lastEarned = existing?.last_earned_at ?? "";
    if (earnedDate !== date) earnedToday = 0;

    // 📝 同じ event の二重付与は台帳の event_key で防ぐ。
    const already = getPointLedgerByEventKey(ctx, `earn:${eventId}`);
    let allowed = already === null && earnedToday < dailyLimit;
    if (allowed && lastEarned !== "") {
      const last = Date.parse(lastEarned);
      if (Number.isNaN(last)) throw new Error(`invalid stored point timestamp: ${lastEarned}`);
      allowed = current.getTime() - last >= cooldownSeconds * 1000;
    }

    let earned = 0;
    if (allowed) {
      if (points > dailyLimit - earnedToday) points = dailyLimit - earnedToday;
      if (points > 0) {
        ctx.db
          .prepare(
            `INSERT INTO point_ledger(transaction_id, event_key, guild_id, user_id, delta, reason, created_at)
             VALUES(?, ?, ?, ?, ?, 'message reward', ?)`,
          )
          .run(ctx.randomId("pt_"), `earn:${eventId}`, guildId, userId, points, ctx.now());
        ctx.db
          .prepare(
            `INSERT INTO point_accounts(guild_id, user_id, balance, earned_today, earned_date, last_earned_at)
             VALUES(?, ?, ?, ?, ?, ?)
             ON CONFLICT(guild_id, user_id) DO UPDATE SET balance = point_accounts.balance + excluded.balance,
               earned_today = excluded.earned_today, earned_date = excluded.earned_date,
               last_earned_at = excluded.last_earned_at`,
          )
          .run(guildId, userId, points, earnedToday + points, date, ctx.now());
        balance += points;
        earned = points;
      }
    }
    return { balance, earned };
  });
  return run();
}

// ------------------------------------------
// 🎲 抽選（旧 DrawLottery 相当）
// ------------------------------------------

// 🎲 抽選を行う。同じ event の再実行は保存済み結果を返す。
export function drawLottery(
  ctx: DbContext,
  args: { guildId: string; userId: string; eventId: string; cost: number; prize: number; chance: number },
): { points: PointResult; won: boolean } {
  const { guildId, userId, eventId, cost, prize, chance } = args;
  if (
    guildId === "" ||
    userId === "" ||
    eventId === "" ||
    cost < 1 ||
    prize < 0 ||
    chance < 0 ||
    chance > 100
  ) {
    throw new Error("invalid lottery parameters");
  }
  const run = ctx.db.transaction((): { points: PointResult; won: boolean } => {
    const saved = getStarFeatureAction(ctx, `lottery:${eventId}`);
    if (saved !== null) {
      const parsed = JSON.parse(saved.result_json) as { points: PointResult; won: boolean };
      return { points: parsed.points, won: parsed.won };
    }
    const account = getPointAccountRow(ctx, guildId, userId);
    if (account === null) throw new Error("insufficient points");
    if (account.balance < cost) {
      throw Object.assign(new Error("insufficient points"), { balance: account.balance });
    }
    const won = ctx.randomInt(100) < chance;
    const reward = won ? -cost + prize : -cost;
    const reason = won ? "lottery:won" : "lottery:lost";
    ctx.db
      .prepare(
        `INSERT INTO point_ledger(transaction_id, event_key, guild_id, user_id, delta, reason, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ctx.randomId("pt_"), `lottery:${eventId}`, guildId, userId, reward, reason, ctx.now());
    ctx.db
      .prepare("UPDATE point_accounts SET balance = balance + ? WHERE guild_id = ? AND user_id = ?")
      .run(reward, guildId, userId);
    const points: PointResult = { balance: account.balance + reward, earned: 0 };
    putStarFeatureAction(ctx, `lottery:${eventId}`, JSON.stringify({ points, won }));
    return { points, won };
  });
  return run();
}

// ------------------------------------------
// 🎴 おみくじ（旧 DrawOmikuji 相当）
// ------------------------------------------

export const OMIKUJI_RESULTS: readonly string[] = [
  "大吉",
  "中吉",
  "小吉",
  "吉",
  "末吉",
  "凶",
] as const;

// 🎴 その日のおみくじ記録を取得する（無ければ null）。
export function getOmikujiDraw(
  ctx: DbContext,
  guildId: string,
  userId: string,
  drawDate: string,
): OmikujiDrawRow | null {
  return (
    (ctx.db
      .prepare(
        "SELECT * FROM omikuji_draws WHERE guild_id = ? AND user_id = ? AND draw_date = ?",
      )
      .get(guildId, userId, drawDate) as OmikujiDrawRow | undefined) ?? null
  );
}

// 🎴 ユーザーのおみくじ履歴を新しい順に返す。
export function listOmikujiDraws(ctx: DbContext, guildId: string, userId: string): OmikujiDrawRow[] {
  return ctx.db
    .prepare(
      "SELECT * FROM omikuji_draws WHERE guild_id = ? AND user_id = ? ORDER BY draw_date DESC",
    )
    .all(guildId, userId) as OmikujiDrawRow[];
}

// 🎴 おみくじを引く。UTC 日付で1日1回。同じ event の再実行は
// 保存済み結果を返す。既に引いている場合は例外にする。
export function drawOmikuji(
  ctx: DbContext,
  args: { guildId: string; userId: string; eventId: string },
): string {
  const { guildId, userId, eventId } = args;
  if (guildId === "" || userId === "" || eventId === "") {
    throw new Error("guild_id, user_id and event_id are required");
  }
  const result = OMIKUJI_RESULTS[ctx.randomInt(OMIKUJI_RESULTS.length)] ?? "吉";
  const run = ctx.db.transaction((): string => {
    const saved = getStarFeatureAction(ctx, `omikuji:${eventId}`);
    if (saved !== null) {
      const parsed = JSON.parse(saved.result_json) as { fortune: string };
      return parsed.fortune;
    }
    const date = formatUtcTimestamp(ctx.nowDate()).slice(0, 10);
    try {
      ctx.db
        .prepare(
          "INSERT INTO omikuji_draws(guild_id, user_id, draw_date, result) VALUES(?, ?, ?, ?)",
        )
        .run(guildId, userId, date, result);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
        throw new Error("omikuji already drawn today");
      }
      throw error;
    }
    ctx.db
      .prepare(
        `INSERT INTO point_ledger(transaction_id, event_key, guild_id, user_id, delta, reason, created_at)
         VALUES(?, ?, ?, ?, 0, 'omikuji', ?)`,
      )
      .run(ctx.randomId("pt_"), `omikuji:${eventId}`, guildId, userId, ctx.now());
    putStarFeatureAction(ctx, `omikuji:${eventId}`, JSON.stringify({ fortune: result }));
    return result;
  });
  return run();
}

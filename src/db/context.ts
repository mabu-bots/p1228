// ==========================================
// 🧰 DB 層の共通コンテキスト（時刻・ID・乱数）
// ==========================================
// 🧰 アクセサ群が共有する土台。旧実装（Go）の formatTime / now /
// randomID に相当し、テストでは時計と乱数を差し替えて固定できる
// （時刻依存のテストは時計を固定する、という家の規約のため）。

import { randomBytes, randomInt as cryptoRandomInt } from "node:crypto";
import type Database from "better-sqlite3";

// ------------------------------------------
// 🕐 時刻の整形
// ------------------------------------------

// 🕐 旧実装と同じ固定幅 UTC 表記にする。
// 形式: 2006-01-02T15:04:05.000000000Z（小数部は9桁固定）。
// 固定幅なので、文字列の辞書順がそのまま時刻順と一致する。
// JavaScript の Date はミリ秒精度のため、下6桁は 0 で埋める。
export function formatUtcTimestamp(value: Date): string {
  const iso = value.toISOString(); // 例: 2026-11-28T04:00:00.123Z
  const [head, tail] = iso.split(".");
  const millis = (tail ?? "0Z").replace("Z", "").padEnd(3, "0").slice(0, 3);
  return `${head}.${millis}000000Z`;
}

// ------------------------------------------
// 🧰 コンテキスト
// ------------------------------------------

export interface DbContext {
  // 💾 better-sqlite3 の接続（単一接続で直列化する。旧実装と同じ）
  db: Database.Database;
  // 🕐 現在時刻を固定幅 UTC 文字列で返す
  now: () => string;
  // 🕐 現在時刻を Date で返す（経過時間の計算用）
  nowDate: () => Date;
  // 🔑 プレフィックスつきのランダム ID を作る（旧 randomID 相当）
  randomId: (prefix: string) => string;
  // 🎲 0 以上 max 未満の乱数を返す（抽選・おみくじ用）
  randomInt: (max: number) => number;
}

export interface DbHooks {
  // 🕐 時計の差し替え（テスト用）。未指定なら実時計
  clock?: () => Date;
  // 🔑 ID 生成の差し替え（テスト用）。未指定なら暗号論的乱数
  randomId?: (prefix: string) => string;
  // 🎲 乱数の差し替え（テスト用）。未指定なら暗号論的乱数
  randomInt?: (max: number) => number;
}

// 🧰 既定のフック（本番用）で DbContext を組み立てる。
export function createContext(db: Database.Database, hooks: DbHooks = {}): DbContext {
  const clock = hooks.clock ?? (() => new Date());
  return {
    db,
    now: () => formatUtcTimestamp(clock()),
    nowDate: clock,
    randomId:
      hooks.randomId ?? ((prefix: string) => prefix + randomBytes(16).toString("hex")),
    randomInt: hooks.randomInt ?? ((max: number) => cryptoRandomInt(max)),
  };
}

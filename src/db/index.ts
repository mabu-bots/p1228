// ==========================================
// 💾 DB 層の入口
// ==========================================
// 💾 既存 SQLite DB（スキーマ 001〜004）をそのまま開く DB 層。
// 使い方: const store = openDatabase({ path: config.dbPath });

export { openDatabase, Store, type OpenOptions } from "./database.js";
export { MIGRATIONS, type Migration } from "./migrations.js";
export { runMigrations, listAppliedMigrations } from "./migrate.js";
export { formatUtcTimestamp, type DbContext, type DbHooks } from "./context.js";
export type * from "./rows.js";
export type { StickyMessage } from "./features.js";
export type { PointResult } from "./points.js";
export { OMIKUJI_RESULTS } from "./points.js";
export { DEFAULT_READ_ALOUD_SETTINGS } from "./readaloud.js";
export type { ShopItem, BuyResult } from "./shop.js";
export type { DictionaryEntry } from "./readaloud.js";
export type { GatewaySession, InboxEvent, ClaimedEvent, WorkerIdentity } from "./infra.js";

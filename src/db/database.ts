// ==========================================
// 💾 DB の接続と Store
// ==========================================
// 💾 既存 DB を better-sqlite3 で開き、旧実装と同じプラグマ
// （WAL / foreign_keys / busy_timeout / synchronous=FULL）を
// 設定してから migration を適用する。
// 書き込みは単一接続で直列化される（better-sqlite3 は同期 API）。

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createContext, type DbContext, type DbHooks } from "./context.js";
import { listAppliedMigrations, runMigrations } from "./migrate.js";
import * as core from "./core.js";
import * as features from "./features.js";
import * as points from "./points.js";
import * as shop from "./shop.js";
import * as readaloud from "./readaloud.js";
import * as infra from "./infra.js";

// ------------------------------------------
// 💾 接続
// ------------------------------------------

export interface OpenOptions {
  // 📦 DB ファイルのパス（":memory:" も可。テスト用）
  path: string;
  // 🕐 時計・ID・乱数の差し替え（テスト用）
  hooks?: DbHooks;
  // 💾 false にすると migration を適用せずに開く（検証用）
  migrate?: boolean;
}

// 💾 Store は全アクセサを束ねた窓口。旧実装の Storage に相当する。
export class Store {
  // 🧰 アクセサ群が共有するコンテキスト
  readonly ctx: DbContext;

  constructor(db: Database.Database, hooks: DbHooks = {}) {
    this.ctx = createContext(db, hooks);
  }

  // 💾 生の接続（疎通確認や検証用）
  get raw(): Database.Database {
    return this.ctx.db;
  }

  // 💾 接続を閉じる
  close(): void {
    this.ctx.db.close();
  }

  // 💾 疎通確認（旧実装の health チェック相当）
  ping(): void {
    this.ctx.db.prepare("SELECT 1").get();
  }

  // 💾 適用済み migration の記録を返す
  appliedMigrations(): { version: number; applied_at: string }[] {
    return listAppliedMigrations(this.ctx.db);
  }

  // ---- 🧱 基盤（core） ----
  upsertBot = (bot: { botId: string; displayName: string; applicationId?: string }) =>
    core.upsertBot(this.ctx, bot);
  getBot = (botId: string) => core.getBot(this.ctx, botId);
  listBots = () => core.listBots(this.ctx);
  setBotEnabled = (botId: string, enabled: boolean) => core.setBotEnabled(this.ctx, botId, enabled);
  upsertGuild = (guild: { guildId: string; name: string }) => core.upsertGuild(this.ctx, guild);
  getGuild = (guildId: string) => core.getGuild(this.ctx, guildId);
  listGuilds = () => core.listGuilds(this.ctx);
  upsertUser = (user: { userId: string; username: string }) => core.upsertUser(this.ctx, user);
  getUser = (userId: string) => core.getUser(this.ctx, userId);
  listUsers = () => core.listUsers(this.ctx);
  getGuildSettings = (guildId: string) => core.getGuildSettings(this.ctx, guildId);
  putGuildSettings = (guildId: string, settingsJson: string) =>
    core.putGuildSettings(this.ctx, guildId, settingsJson);
  getUserSettings = (userId: string) => core.getUserSettings(this.ctx, userId);
  putUserSettings = (userId: string, settingsJson: string) =>
    core.putUserSettings(this.ctx, userId, settingsJson);
  getAudioEngineSettings = (engineId: string) => core.getAudioEngineSettings(this.ctx, engineId);
  listAudioEngineSettings = () => core.listAudioEngineSettings(this.ctx);
  putAudioEngineSettings = (engineId: string, configJson: string) =>
    core.putAudioEngineSettings(this.ctx, engineId, configJson);

  // ---- ⭐ 機能設定（features） ----
  getGuildFeatureSettings = (guildId: string) => features.getGuildFeatureSettings(this.ctx, guildId);
  setGuildFeatureSetting = (guildId: string, key: string, valueJson: string) =>
    features.setGuildFeatureSetting(this.ctx, guildId, key, valueJson);
  deleteGuildFeatureSetting = (guildId: string, key: string) =>
    features.deleteGuildFeatureSetting(this.ctx, guildId, key);
  listGuildFeatureSettings = (guildId: string) => features.listGuildFeatureSettings(this.ctx, guildId);
  addGuildBlacklist = (guildId: string, userId: string, reason: string) =>
    features.addGuildBlacklist(this.ctx, guildId, userId, reason);
  removeGuildBlacklist = (guildId: string, userId: string) =>
    features.removeGuildBlacklist(this.ctx, guildId, userId);
  isGuildBlacklisted = (guildId: string, userId: string) =>
    features.isGuildBlacklisted(this.ctx, guildId, userId);
  listGuildBlacklist = (guildId: string) => features.listGuildBlacklist(this.ctx, guildId);
  setStickyMessage = (sticky: features.StickyMessage) => features.setStickyMessage(this.ctx, sticky);
  getStickyMessage = (guildId: string, channelId: string) =>
    features.getStickyMessage(this.ctx, guildId, channelId);
  listStickyMessages = (guildId: string) => features.listStickyMessages(this.ctx, guildId);
  removeStickyMessage = (guildId: string, channelId: string) =>
    features.removeStickyMessage(this.ctx, guildId, channelId);
  updateStickyMessageId = (
    guildId: string,
    channelId: string,
    oldMessageId: string,
    newMessageId: string,
  ) => features.updateStickyMessageId(this.ctx, guildId, channelId, oldMessageId, newMessageId);

  // ---- 🎮 ポイント（points） ----
  getPointAccountRow = (guildId: string, userId: string) =>
    points.getPointAccountRow(this.ctx, guildId, userId);
  getPointBalance = (guildId: string, userId: string) =>
    points.getPointBalance(this.ctx, guildId, userId);
  listPointAccounts = (guildId: string) => points.listPointAccounts(this.ctx, guildId);
  listPointLedger = (guildId: string, userId: string, limit?: number) =>
    points.listPointLedger(this.ctx, guildId, userId, limit);
  getPointLedgerByEventKey = (eventKey: string) => points.getPointLedgerByEventKey(this.ctx, eventKey);
  getStarFeatureAction = (eventKey: string) => points.getStarFeatureAction(this.ctx, eventKey);
  putStarFeatureAction = (eventKey: string, resultJson: string) =>
    points.putStarFeatureAction(this.ctx, eventKey, resultJson);
  earnPoints = (args: Parameters<typeof points.earnPoints>[1]) => points.earnPoints(this.ctx, args);
  drawLottery = (args: Parameters<typeof points.drawLottery>[1]) => points.drawLottery(this.ctx, args);
  getOmikujiDraw = (guildId: string, userId: string, drawDate: string) =>
    points.getOmikujiDraw(this.ctx, guildId, userId, drawDate);
  listOmikujiDraws = (guildId: string, userId: string) =>
    points.listOmikujiDraws(this.ctx, guildId, userId);
  drawOmikuji = (args: Parameters<typeof points.drawOmikuji>[1]) => points.drawOmikuji(this.ctx, args);

  // ---- 🛍️ ショップ（shop） ----
  upsertShopItem = (guildId: string, item: shop.ShopItem) => shop.upsertShopItem(this.ctx, guildId, item);
  getShopItem = (guildId: string, itemId: string) => shop.getShopItem(this.ctx, guildId, itemId);
  listShopItems = (guildId: string) => shop.listShopItems(this.ctx, guildId);
  setShopItemEnabled = (guildId: string, itemId: string, enabled: boolean) =>
    shop.setShopItemEnabled(this.ctx, guildId, itemId, enabled);
  getInventoryItem = (guildId: string, userId: string, itemId: string) =>
    shop.getInventoryItem(this.ctx, guildId, userId, itemId);
  listInventory = (guildId: string, userId: string) => shop.listInventory(this.ctx, guildId, userId);
  listPendingRoleGrants = (guildId: string) => shop.listPendingRoleGrants(this.ctx, guildId);
  buyShopItem = (args: Parameters<typeof shop.buyShopItem>[1]) => shop.buyShopItem(this.ctx, args);
  completeShopRoleGrant = (guildId: string, userId: string, itemId: string) =>
    shop.completeShopRoleGrant(this.ctx, guildId, userId, itemId);

  // ---- 🔊 読み上げ・辞書・監査（readaloud） ----
  getReadAloudSettings = (scope: string, scopeId: string) =>
    readaloud.getReadAloudSettings(this.ctx, scope, scopeId);
  getReadAloudSettingsRow = (scope: string, scopeId: string) =>
    readaloud.getReadAloudSettingsRow(this.ctx, scope, scopeId);
  putReadAloudSettings = (scope: string, scopeId: string, settingsJson: string, actor: string) =>
    readaloud.putReadAloudSettings(this.ctx, scope, scopeId, settingsJson, actor);
  getDictionary = (scope: string, scopeId: string) => readaloud.getDictionary(this.ctx, scope, scopeId);
  listDictionaries = () => readaloud.listDictionaries(this.ctx);
  listDictionaryEntries = (scope: string, scopeId: string) =>
    readaloud.listDictionaryEntries(this.ctx, scope, scopeId);
  listDictionaryEntryRows = (scope: string, scopeId: string) =>
    readaloud.listDictionaryEntryRows(this.ctx, scope, scopeId);
  putDictionaryEntry = (args: Parameters<typeof readaloud.putDictionaryEntry>[1]) =>
    readaloud.putDictionaryEntry(this.ctx, args);
  deleteDictionaryEntry = (scope: string, scopeId: string, word: string) =>
    readaloud.deleteDictionaryEntry(this.ctx, scope, scopeId, word);
  appendAuditLog = (entry: Parameters<typeof readaloud.appendAuditLog>[1]) =>
    readaloud.appendAuditLog(this.ctx, entry);
  listAuditLogs = (limit?: number) => readaloud.listAuditLogs(this.ctx, limit);

  // ---- 📨 配送基盤（infra） ----
  loadSession = (botId: string) => infra.loadSession(this.ctx, botId);
  getGatewaySessionRow = (botId: string) => infra.getGatewaySessionRow(this.ctx, botId);
  clearSession = (botId: string) => infra.clearSession(this.ctx, botId);
  recordDispatch = (session: infra.GatewaySession, event: infra.InboxEvent | null) =>
    infra.recordDispatch(this.ctx, session, event);
  getEventInboxRow = (eventId: string) => infra.getEventInboxRow(this.ctx, eventId);
  listEventInbox = (botId: string, status?: string, limit?: number) =>
    infra.listEventInbox(this.ctx, botId, status, limit);
  claimEvent = (args: Parameters<typeof infra.claimEvent>[1]) => infra.claimEvent(this.ctx, args);
  ackEvent = (botId: string, eventId: string, token: string) =>
    infra.ackEvent(this.ctx, botId, eventId, token);
  nackEvent = (args: Parameters<typeof infra.nackEvent>[1]) => infra.nackEvent(this.ctx, args);
  getEventDeadLetter = (eventId: string) => infra.getEventDeadLetter(this.ctx, eventId);
  listEventDeadLetters = (botId?: string) => infra.listEventDeadLetters(this.ctx, botId);
  insertEventDeadLetter = (letter: Parameters<typeof infra.insertEventDeadLetter>[1]) =>
    infra.insertEventDeadLetter(this.ctx, letter);
  registerWorker = (instanceId: string, worker: infra.WorkerIdentity) =>
    infra.registerWorker(this.ctx, instanceId, worker);
  isWorkerRegistered = (instanceId: string, workerId: string, botId: string) =>
    infra.isWorkerRegistered(this.ctx, instanceId, workerId, botId);
  heartbeat = (instanceId: string, workerId: string, botId: string) =>
    infra.heartbeat(this.ctx, instanceId, workerId, botId);
  latestWorkerHeartbeats = () => infra.latestWorkerHeartbeats(this.ctx);
  getWorkerInstance = (instanceId: string) => infra.getWorkerInstance(this.ctx, instanceId);
  listWorkerInstances = () => infra.listWorkerInstances(this.ctx);
  createOperation = (id: string, botId: string, operation: string) =>
    infra.createOperation(this.ctx, id, botId, operation);
  getOperationResult = (id: string, botId: string, operation: string) =>
    infra.getOperationResult(this.ctx, id, botId, operation);
  getOperation = (operationId: string) => infra.getOperation(this.ctx, operationId);
  updateOperation = (args: Parameters<typeof infra.updateOperation>[1]) =>
    infra.updateOperation(this.ctx, args);
  putEventIdempotencyKey = (handlerKey: string, idempotencyKey: string, expiresAt: string) =>
    infra.putEventIdempotencyKey(this.ctx, handlerKey, idempotencyKey, expiresAt);
  hasEventIdempotencyKey = (handlerKey: string, idempotencyKey: string) =>
    infra.hasEventIdempotencyKey(this.ctx, handlerKey, idempotencyKey);
  listEventIdempotencyKeys = () => infra.listEventIdempotencyKeys(this.ctx);
  deleteExpiredEventIdempotencyKeys = () => infra.deleteExpiredEventIdempotencyKeys(this.ctx);
  pruneExpiredEvents = (retentionHours: number) => infra.pruneExpiredEvents(this.ctx, retentionHours);
}

// ------------------------------------------
// 💾 開く
// ------------------------------------------

// 💾 DB を開き、プラグマ設定と migration 適用までを行う。
// 既存 DB（本番）に対しては、記録済み migration は再実行されない。
export function openDatabase(options: OpenOptions): Store {
  if (options.path !== ":memory:") {
    mkdirSync(dirname(options.path), { recursive: true });
  }
  const db = new Database(options.path);
  // 💾 旧実装と同じプラグマ。接続は1本だけ使い、書き込みを直列化する。
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  const store = new Store(db, options.hooks);
  if (options.migrate !== false) {
    try {
      runMigrations(db, store.ctx.nowDate());
    } catch (error) {
      db.close();
      throw error;
    }
  }
  return store;
}

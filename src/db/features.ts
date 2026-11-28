// ==========================================
// ⭐ 星燈の機能設定アクセサ
// ==========================================
// ⭐ guild_feature_settings / guild_user_blacklist / sticky_messages
// の読み書き。旧実装（Go の star_features.go）のクエリと意味を
// そのまま移したもの。

import type { DbContext } from "./context.js";
import type {
  GuildFeatureSettingRow,
  GuildUserBlacklistRow,
  StickyMessageRow,
} from "./rows.js";

// ------------------------------------------
// ⚙️ ギルド機能設定
// ------------------------------------------

// ⚙️ ギルドの全機能設定を setting_key → JSON 文字列の対応で返す
// （旧 GetGuildFeatureSettings 相当）。
export function getGuildFeatureSettings(ctx: DbContext, guildId: string): Map<string, string> {
  const rows = ctx.db
    .prepare(
      "SELECT setting_key, setting_json FROM guild_feature_settings WHERE guild_id = ?",
    )
    .all(guildId) as Pick<GuildFeatureSettingRow, "setting_key" | "setting_json">[];
  return new Map(rows.map((row) => [row.setting_key, row.setting_json]));
}

// ⚙️ 機能設定を1件保存する（旧 SetGuildFeatureSetting 相当）。
export function setGuildFeatureSetting(
  ctx: DbContext,
  guildId: string,
  key: string,
  valueJson: string,
): void {
  if (guildId.trim() === "" || key.trim() === "" || key.length > 100) {
    throw new Error("guild_id, setting key and valid JSON value are required");
  }
  if (valueJson.length > 16 << 10) throw new Error("setting value is too large");
  try {
    JSON.parse(valueJson);
  } catch {
    throw new Error("guild_id, setting key and valid JSON value are required");
  }
  ctx.db
    .prepare(
      `INSERT INTO guild_feature_settings(guild_id, setting_key, setting_json, updated_at) VALUES(?, ?, ?, ?)
       ON CONFLICT(guild_id, setting_key) DO UPDATE SET setting_json = excluded.setting_json,
         updated_at = excluded.updated_at`,
    )
    .run(guildId, key, valueJson, ctx.now());
}

// ⚙️ 機能設定を1件削除する。
export function deleteGuildFeatureSetting(ctx: DbContext, guildId: string, key: string): void {
  ctx.db
    .prepare("DELETE FROM guild_feature_settings WHERE guild_id = ? AND setting_key = ?")
    .run(guildId, key);
}

// ⚙️ ギルドの全機能設定を行のまま返す。
export function listGuildFeatureSettings(
  ctx: DbContext,
  guildId: string,
): GuildFeatureSettingRow[] {
  return ctx.db
    .prepare("SELECT * FROM guild_feature_settings WHERE guild_id = ? ORDER BY setting_key")
    .all(guildId) as GuildFeatureSettingRow[];
}

// ------------------------------------------
// 🚫 ブラックリスト
// ------------------------------------------

// 🚫 ブラックリストへ追加する（旧 AddGuildBlacklist 相当）。
export function addGuildBlacklist(
  ctx: DbContext,
  guildId: string,
  userId: string,
  reason: string,
): void {
  if (guildId.trim() === "" || userId.trim() === "" || [...reason].length > 500) {
    throw new Error("valid guild_id and user_id are required");
  }
  ctx.db
    .prepare(
      `INSERT INTO guild_user_blacklist(guild_id, user_id, reason, created_at) VALUES(?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason,
         created_at = excluded.created_at`,
    )
    .run(guildId, userId, reason, ctx.now());
}

// 🚫 ブラックリストから削除する（旧 RemoveGuildBlacklist 相当）。
export function removeGuildBlacklist(ctx: DbContext, guildId: string, userId: string): void {
  ctx.db
    .prepare("DELETE FROM guild_user_blacklist WHERE guild_id = ? AND user_id = ?")
    .run(guildId, userId);
}

// 🚫 ブラックリストに入っているかを返す（旧 IsGuildBlacklisted 相当）。
export function isGuildBlacklisted(ctx: DbContext, guildId: string, userId: string): boolean {
  const row = ctx.db
    .prepare(
      "SELECT EXISTS(SELECT 1 FROM guild_user_blacklist WHERE guild_id = ? AND user_id = ?) AS found",
    )
    .get(guildId, userId) as { found: number };
  return row.found === 1;
}

// 🚫 ギルドのブラックリスト全件を返す。
export function listGuildBlacklist(ctx: DbContext, guildId: string): GuildUserBlacklistRow[] {
  return ctx.db
    .prepare("SELECT * FROM guild_user_blacklist WHERE guild_id = ? ORDER BY user_id")
    .all(guildId) as GuildUserBlacklistRow[];
}

// ------------------------------------------
// 📌 スティッキーメッセージ
// ------------------------------------------

export interface StickyMessage {
  guildId: string;
  channelId: string;
  messageId: string;
  content: string;
}

// 📌 スティッキーを保存する（旧 SetStickyMessage 相当）。
export function setStickyMessage(ctx: DbContext, sticky: StickyMessage): void {
  if (
    sticky.guildId === "" ||
    sticky.channelId === "" ||
    sticky.content.trim() === "" ||
    [...sticky.content].length > 2000
  ) {
    throw new Error("guild_id, channel_id and message content are required");
  }
  ctx.db
    .prepare(
      `INSERT INTO sticky_messages(guild_id, channel_id, message_id, content, updated_at) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, channel_id) DO UPDATE SET message_id = excluded.message_id,
         content = excluded.content, updated_at = excluded.updated_at`,
    )
    .run(sticky.guildId, sticky.channelId, sticky.messageId, sticky.content, ctx.now());
}

// 📌 スティッキーを1件取得する（無ければ null。旧 GetStickyMessage 相当）。
export function getStickyMessage(
  ctx: DbContext,
  guildId: string,
  channelId: string,
): StickyMessage | null {
  const row = ctx.db
    .prepare(
      "SELECT guild_id, channel_id, message_id, content FROM sticky_messages WHERE guild_id = ? AND channel_id = ?",
    )
    .get(guildId, channelId) as
    | Pick<StickyMessageRow, "guild_id" | "channel_id" | "message_id" | "content">
    | undefined;
  if (row === undefined) return null;
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    content: row.content,
  };
}

// 📌 ギルドのスティッキー全件を返す（旧 ListStickyMessages 相当）。
export function listStickyMessages(ctx: DbContext, guildId: string): StickyMessageRow[] {
  return ctx.db
    .prepare("SELECT * FROM sticky_messages WHERE guild_id = ? ORDER BY channel_id")
    .all(guildId) as StickyMessageRow[];
}

// 📌 スティッキーを削除する（旧 RemoveStickyMessage 相当）。
export function removeStickyMessage(ctx: DbContext, guildId: string, channelId: string): void {
  ctx.db
    .prepare("DELETE FROM sticky_messages WHERE guild_id = ? AND channel_id = ?")
    .run(guildId, channelId);
}

// 📌 再投稿後のメッセージ ID だけを差し替える（旧 UpdateStickyMessageID 相当）。
// 元の message_id が一致しない場合は、設定が先に変わったとみなして例外にする。
export function updateStickyMessageId(
  ctx: DbContext,
  guildId: string,
  channelId: string,
  oldMessageId: string,
  newMessageId: string,
): void {
  const result = ctx.db
    .prepare(
      "UPDATE sticky_messages SET message_id = ?, updated_at = ? WHERE guild_id = ? AND channel_id = ? AND message_id = ?",
    )
    .run(newMessageId, ctx.now(), guildId, channelId, oldMessageId);
  if (result.changes !== 1) {
    throw new Error("sticky message configuration changed before its message ID could be updated");
  }
}

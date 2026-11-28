// ==========================================
// 🧱 基盤テーブルのアクセサ
// ==========================================
// 🧱 bots / guilds / users と、JSON 設定テーブル（guild_settings /
// user_settings / audio_engine_settings）の読み書き。
//
// ⚠️ 旧実装（Go）には guilds / users / guild_settings /
// user_settings / audio_engine_settings へのアクセサが存在せず、
// これらのテーブルはスキーマのみが存在していた。ここでは Phase 2
// 以降の実装に備えた最小の汎用アクセサを用意する（新規追加であり、
// 旧実装の利用実態とは異なる点として DESIGN にも記録する）。

import type { DbContext } from "./context.js";
import type {
  AudioEngineSettingsRow,
  BotRow,
  GuildRow,
  GuildSettingsRow,
  UserRow,
  UserSettingsRow,
} from "./rows.js";

// ------------------------------------------
// 🤖 bots
// ------------------------------------------

// 🤖 Bot の登録・更新（旧 UpsertBot 相当。bot_user_id は触らない）。
export function upsertBot(
  ctx: DbContext,
  bot: { botId: string; displayName: string; applicationId?: string },
): void {
  ctx.db
    .prepare(
      `INSERT INTO bots(bot_id, display_name, application_id) VALUES(?, ?, ?)
       ON CONFLICT(bot_id) DO UPDATE SET display_name = excluded.display_name,
         application_id = excluded.application_id`,
    )
    .run(bot.botId, bot.displayName, bot.applicationId ?? "");
}

// 🤖 Bot を1件取得する（無ければ null）。
export function getBot(ctx: DbContext, botId: string): BotRow | null {
  return (
    (ctx.db.prepare("SELECT * FROM bots WHERE bot_id = ?").get(botId) as BotRow | undefined) ??
    null
  );
}

// 🤖 全 Bot を bot_id 順に取得する。
export function listBots(ctx: DbContext): BotRow[] {
  return ctx.db.prepare("SELECT * FROM bots ORDER BY bot_id").all() as BotRow[];
}

// 🤖 Bot の有効/無効を切り替える。
export function setBotEnabled(ctx: DbContext, botId: string, enabled: boolean): void {
  ctx.db.prepare("UPDATE bots SET enabled = ? WHERE bot_id = ?").run(enabled ? 1 : 0, botId);
}

// ------------------------------------------
// 🏠 guilds / users（旧実装にアクセサなし: 汎用）
// ------------------------------------------

// 🏠 ギルドの登録・名前更新。created_at は初回登録時のものを保持する。
export function upsertGuild(ctx: DbContext, guild: { guildId: string; name: string }): void {
  ctx.db
    .prepare(
      `INSERT INTO guilds(guild_id, name, created_at) VALUES(?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET name = excluded.name`,
    )
    .run(guild.guildId, guild.name, ctx.now());
}

// 🏠 ギルドを1件取得する（無ければ null）。
export function getGuild(ctx: DbContext, guildId: string): GuildRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM guilds WHERE guild_id = ?")
      .get(guildId) as GuildRow | undefined) ?? null
  );
}

// 🏠 全ギルドを guild_id 順に取得する。
export function listGuilds(ctx: DbContext): GuildRow[] {
  return ctx.db.prepare("SELECT * FROM guilds ORDER BY guild_id").all() as GuildRow[];
}

// 👤 ユーザーの登録・名前更新。created_at は初回登録時のものを保持する。
export function upsertUser(ctx: DbContext, user: { userId: string; username: string }): void {
  ctx.db
    .prepare(
      `INSERT INTO users(user_id, username, created_at) VALUES(?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET username = excluded.username`,
    )
    .run(user.userId, user.username, ctx.now());
}

// 👤 ユーザーを1件取得する（無ければ null）。
export function getUser(ctx: DbContext, userId: string): UserRow | null {
  return (
    (ctx.db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as UserRow | undefined) ??
    null
  );
}

// 👤 全ユーザーを user_id 順に取得する。
export function listUsers(ctx: DbContext): UserRow[] {
  return ctx.db.prepare("SELECT * FROM users ORDER BY user_id").all() as UserRow[];
}

// ------------------------------------------
// ⚙️ JSON 設定（guild_settings / user_settings）
// ------------------------------------------

// ⚙️ ギルド設定を取得する（無ければ null）。settings_json は文字列のまま返す。
export function getGuildSettings(ctx: DbContext, guildId: string): GuildSettingsRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM guild_settings WHERE guild_id = ?")
      .get(guildId) as GuildSettingsRow | undefined) ?? null
  );
}

// ⚙️ ギルド設定を保存し、revision を進めて新しい revision を返す。
export function putGuildSettings(ctx: DbContext, guildId: string, settingsJson: string): number {
  if (!isJson(settingsJson)) throw new Error("settings must be valid JSON");
  ctx.db
    .prepare(
      `INSERT INTO guild_settings(guild_id, settings_json, revision, updated_at) VALUES(?, ?, 1, ?)
       ON CONFLICT(guild_id) DO UPDATE SET settings_json = excluded.settings_json,
         revision = guild_settings.revision + 1, updated_at = excluded.updated_at`,
    )
    .run(guildId, settingsJson, ctx.now());
  const row = getGuildSettings(ctx, guildId);
  return row?.revision ?? 1;
}

// ⚙️ ユーザー設定を取得する（無ければ null）。
export function getUserSettings(ctx: DbContext, userId: string): UserSettingsRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM user_settings WHERE user_id = ?")
      .get(userId) as UserSettingsRow | undefined) ?? null
  );
}

// ⚙️ ユーザー設定を保存し、revision を進めて新しい revision を返す。
export function putUserSettings(ctx: DbContext, userId: string, settingsJson: string): number {
  if (!isJson(settingsJson)) throw new Error("settings must be valid JSON");
  ctx.db
    .prepare(
      `INSERT INTO user_settings(user_id, settings_json, revision, updated_at) VALUES(?, ?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json,
         revision = user_settings.revision + 1, updated_at = excluded.updated_at`,
    )
    .run(userId, settingsJson, ctx.now());
  const row = getUserSettings(ctx, userId);
  return row?.revision ?? 1;
}

// ------------------------------------------
// 🎙️ audio_engine_settings（旧実装にアクセサなし: 汎用）
// ------------------------------------------

// 🎙️ 音声エンジン設定を取得する（無ければ null）。
export function getAudioEngineSettings(
  ctx: DbContext,
  engineId: string,
): AudioEngineSettingsRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM audio_engine_settings WHERE engine_id = ?")
      .get(engineId) as AudioEngineSettingsRow | undefined) ?? null
  );
}

// 🎙️ 全音声エンジン設定を engine_id 順に取得する。
export function listAudioEngineSettings(ctx: DbContext): AudioEngineSettingsRow[] {
  return ctx.db
    .prepare("SELECT * FROM audio_engine_settings ORDER BY engine_id")
    .all() as AudioEngineSettingsRow[];
}

// 🎙️ 音声エンジン設定を保存し、revision を進めて新しい revision を返す。
export function putAudioEngineSettings(
  ctx: DbContext,
  engineId: string,
  configJson: string,
): number {
  if (!isJson(configJson)) throw new Error("config must be valid JSON");
  ctx.db
    .prepare(
      `INSERT INTO audio_engine_settings(engine_id, config_json, revision, updated_at) VALUES(?, ?, 1, ?)
       ON CONFLICT(engine_id) DO UPDATE SET config_json = excluded.config_json,
         revision = audio_engine_settings.revision + 1, updated_at = excluded.updated_at`,
    )
    .run(engineId, configJson, ctx.now());
  const row = getAudioEngineSettings(ctx, engineId);
  return row?.revision ?? 1;
}

// ------------------------------------------
// 🧰 ヘルパー
// ------------------------------------------

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

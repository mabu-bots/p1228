// ==========================================
// 📋 テーブルの行型（25テーブル＋schema_migrations）
// ==========================================
// 📋 旧スキーマ 001〜004 の列構成をそのまま型にしたもの。
// 列名は snake_case のまま（DB の列名と一致させるため）。
// 真偽値を表す INTEGER 列は number として持ち、変換は呼び出し側で行う。

// ------------------------------------------
// 🧱 基盤（001）
// ------------------------------------------

export interface SchemaMigrationRow {
  version: number;
  applied_at: string;
}

export interface BotRow {
  bot_id: string;
  display_name: string;
  application_id: string;
  bot_user_id: string;
  enabled: number;
}

export interface GuildRow {
  guild_id: string;
  name: string;
  created_at: string;
}

export interface UserRow {
  user_id: string;
  username: string;
  created_at: string;
}

export interface GuildSettingsRow {
  guild_id: string;
  settings_json: string;
  revision: number;
  updated_at: string;
}

export interface UserSettingsRow {
  user_id: string;
  settings_json: string;
  revision: number;
  updated_at: string;
}

export interface DictionaryRow {
  dictionary_id: string;
  scope: string;
  scope_id: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface DictionaryEntryRow {
  entry_id: string;
  dictionary_id: string;
  scope: string;
  scope_id: string;
  word: string;
  reading: string;
  created_at: string;
  updated_at: string;
}

export interface AudioEngineSettingsRow {
  engine_id: string;
  config_json: string;
  revision: number;
  updated_at: string;
}

export interface ReadAloudSettingsRow {
  scope: string;
  scope_id: string;
  settings_json: string;
  revision: number;
  updated_at: string;
}

export interface AuditLogRow {
  id: number;
  actor: string;
  action: string;
  target: string;
  details_json: string;
  created_at: string;
}

// ------------------------------------------
// 📨 配送基盤（001）
// ------------------------------------------

export interface EventIdempotencyKeyRow {
  handler_key: string;
  idempotency_key: string;
  expires_at: string;
  created_at: string;
}

export interface GatewaySessionRow {
  bot_id: string;
  session_id: string;
  resume_gateway_url: string;
  last_sequence: number;
  bot_user_id: string;
  updated_at: string;
}

export interface EventInboxRow {
  event_id: string;
  correlation_id: string;
  bot_id: string;
  session_id: string;
  sequence: number;
  event_type: string;
  ordering_key: string;
  occurred_at: string;
  received_at: string;
  bot_user_id: string;
  payload_json: string;
  status: string;
  attempts: number;
  not_before: string | null;
  lease_until: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  last_error: string | null;
}

export interface EventDeadLetterRow {
  event_id: string;
  bot_id: string;
  event_type: string;
  reason: string;
  attempts: number;
  payload_json: string;
  created_at: string;
}

export interface WorkerInstanceRow {
  instance_id: string;
  worker_id: string;
  role: string;
  bot_id: string;
  started_at: string;
  last_heartbeat: string;
  status: string;
}

export interface DiscordOperationRow {
  operation_id: string;
  bot_id: string;
  operation: string;
  status: string;
  response_ref: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ------------------------------------------
// ⭐ 星燈の機能（002〜004）
// ------------------------------------------

export interface GuildFeatureSettingRow {
  guild_id: string;
  setting_key: string;
  setting_json: string;
  updated_at: string;
}

export interface GuildUserBlacklistRow {
  guild_id: string;
  user_id: string;
  reason: string;
  created_at: string;
}

export interface StickyMessageRow {
  guild_id: string;
  channel_id: string;
  message_id: string;
  content: string;
  updated_at: string;
}

export interface PointAccountRow {
  guild_id: string;
  user_id: string;
  balance: number;
  earned_today: number;
  earned_date: string;
  last_earned_at: string;
}

export interface PointLedgerRow {
  transaction_id: string;
  event_key: string;
  guild_id: string;
  user_id: string;
  delta: number;
  reason: string;
  created_at: string;
}

export interface ShopItemRow {
  guild_id: string;
  item_id: string;
  name: string;
  price: number;
  role_id: string;
  enabled: number;
  created_at: string;
}

export interface UserInventoryRow {
  guild_id: string;
  user_id: string;
  item_id: string;
  purchased_at: string;
  // 🎭 003 で追加: ロール付与の状態（pending / fulfilled）
  role_status: string;
  // 🎭 003 で追加: 購入時点のロール ID
  role_id: string;
}

export interface OmikujiDrawRow {
  guild_id: string;
  user_id: string;
  draw_date: string;
  result: string;
}

export interface StarFeatureActionRow {
  event_key: string;
  result_json: string;
  created_at: string;
}

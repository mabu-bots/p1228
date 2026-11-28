-- ===== 1. 基盤テーブル =====
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bots (
    bot_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    application_id TEXT NOT NULL DEFAULT '',
    bot_user_id TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id),
    settings_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    settings_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

-- ===== 2. 辞書と音声エンジン設定 =====
CREATE TABLE IF NOT EXISTS dictionaries (
    dictionary_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(scope, scope_id)
);

CREATE TABLE IF NOT EXISTS audio_engine_settings (
    engine_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

-- ===== 3. イベント基盤テーブル =====
CREATE TABLE IF NOT EXISTS event_idempotency_keys (
    handler_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(handler_key, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON event_idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS gateway_sessions (
    bot_id TEXT PRIMARY KEY REFERENCES bots(bot_id),
    session_id TEXT NOT NULL DEFAULT '',
    resume_gateway_url TEXT NOT NULL DEFAULT '',
    last_sequence INTEGER NOT NULL DEFAULT -1,
    bot_user_id TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_inbox (
    event_id TEXT PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES bots(bot_id),
    session_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    ordering_key TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    bot_user_id TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    not_before TEXT,
    lease_until TEXT,
    lease_owner TEXT,
    lease_token TEXT,
    last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_claim ON event_inbox(bot_id, status, not_before, lease_until, received_at);
CREATE INDEX IF NOT EXISTS idx_event_ordering ON event_inbox(bot_id, ordering_key, received_at, status);

CREATE TABLE IF NOT EXISTS event_dead_letters (
    event_id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(bot_id),
    event_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_instances (
    instance_id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL,
    role TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES bots(bot_id),
    started_at TEXT NOT NULL,
    last_heartbeat TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'online'
);
CREATE INDEX IF NOT EXISTS idx_worker_heartbeat ON worker_instances(worker_id, last_heartbeat);

CREATE TABLE IF NOT EXISTS discord_operations (
    operation_id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(bot_id),
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    response_ref TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ===== 4. 読み上げ設定と監査ログ =====
CREATE TABLE IF NOT EXISTS read_aloud_settings (
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(scope, scope_id)
);

CREATE TABLE IF NOT EXISTS dictionary_entries (
    entry_id TEXT PRIMARY KEY,
    dictionary_id TEXT NOT NULL REFERENCES dictionaries(dictionary_id),
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id TEXT NOT NULL DEFAULT 'global',
    word TEXT NOT NULL,
    reading TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(scope, scope_id, word)
);
CREATE INDEX IF NOT EXISTS idx_dictionary_scope ON dictionary_entries(scope, scope_id);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

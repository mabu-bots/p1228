-- ===== 1. ギルド機能設定とブラックリスト =====
CREATE TABLE IF NOT EXISTS guild_feature_settings (
    guild_id TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    setting_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, setting_key)
);

CREATE TABLE IF NOT EXISTS guild_user_blacklist (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

-- ===== 2. スティッキーとポイント =====
CREATE TABLE IF NOT EXISTS sticky_messages (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
);

CREATE TABLE IF NOT EXISTS point_accounts (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    earned_today INTEGER NOT NULL DEFAULT 0 CHECK (earned_today >= 0),
    earned_date TEXT NOT NULL DEFAULT '',
    last_earned_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS point_ledger (
    transaction_id TEXT PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_point_ledger_user ON point_ledger(guild_id, user_id, created_at);

-- ===== 3. ショップとおみくじ =====
CREATE TABLE IF NOT EXISTS shop_items (
    guild_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price > 0),
    role_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, item_id)
);

CREATE TABLE IF NOT EXISTS user_inventory (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    purchased_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, item_id)
);

CREATE TABLE IF NOT EXISTS omikuji_draws (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    draw_date TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, draw_date)
);

-- ===== 4. 機能アクションの冪等性 =====
CREATE TABLE IF NOT EXISTS star_feature_actions (
    event_key TEXT PRIMARY KEY,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- ===== 1. ロール付与状態の追加 =====
ALTER TABLE user_inventory
    ADD COLUMN role_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (role_status IN ('pending', 'fulfilled'));
-- ===== 2. ロールIDの追加 =====
ALTER TABLE user_inventory
    ADD COLUMN role_id TEXT NOT NULL DEFAULT '';

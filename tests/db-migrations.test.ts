// ==========================================
// 💾 DB 層テスト: マイグレーションとスキーマ互換
// ==========================================
// 💾 空 DB への適用、記録済み DB の再オープン（再適用しないこと）、
// 旧形式（001 / 002 のみ適用済み）DB のアップグレードを検証する。
// 時刻は全て固定時計で与える。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS, openDatabase } from "../src/db/index.js";

// ------------------------------------------
// 🧰 フィクスチャの土台
// ------------------------------------------

const T1 = new Date("2026-11-28T12:00:00.000Z");
const T2 = new Date("2026-11-29T12:00:00.000Z");

function tempDbPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "p1228-db-test-"));
  return { dir, path: join(dir, "test.sqlite3") };
}

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

// 📋 DESIGN §3.3 の25テーブル＋schema_migrations
const EXPECTED_TABLES = [
  "audio_engine_settings",
  "audit_logs",
  "bots",
  "dictionaries",
  "dictionary_entries",
  "discord_operations",
  "event_dead_letters",
  "event_idempotency_keys",
  "event_inbox",
  "gateway_sessions",
  "guild_feature_settings",
  "guild_settings",
  "guild_user_blacklist",
  "guilds",
  "omikuji_draws",
  "point_accounts",
  "point_ledger",
  "read_aloud_settings",
  "schema_migrations",
  "shop_items",
  "star_feature_actions",
  "sticky_messages",
  "user_inventory",
  "user_settings",
  "users",
  "worker_instances",
];

// ------------------------------------------
// 💾 埋め込み SQL の同一性
// ------------------------------------------

test("埋め込み SQL は同梱の .sql ファイルと完全一致する", () => {
  const files = [
    "001_initial.sql",
    "002_star_features.sql",
    "003_shop_role_fulfillment.sql",
    "004_backfill_legacy_shop_fulfillment.sql",
  ];
  assert.equal(MIGRATIONS.length, 4);
  MIGRATIONS.forEach((migration, index) => {
    // 📁 テストは dist/tests から動くため、ソースツリー側の原典を読む
    const onDisk = readFileSync(
      new URL(`../../src/db/migrations/${files[index]}`, import.meta.url),
      "utf8",
    );
    assert.equal(migration.version, index + 1);
    assert.equal(migration.sql, onDisk);
  });
});

// ------------------------------------------
// 💾 空 DB への適用
// ------------------------------------------

test("空 DB に 001〜004 が適用され、25テーブル＋記録が揃う", () => {
  const { dir, path } = tempDbPath();
  try {
    const store = openDatabase({ path, hooks: { clock: () => T1 } });
    assert.deepEqual(tableNames(store.raw), EXPECTED_TABLES);
    // 📝 記録は4件、適用時刻は固定時計の値
    const applied = store.appliedMigrations();
    assert.deepEqual(
      applied.map((row) => row.version),
      [1, 2, 3, 4],
    );
    assert.ok(applied.every((row) => row.applied_at === "2026-11-28T12:00:00.000000000Z"));
    // 🎭 003 の列が user_inventory にある
    const columns = store.raw
      .prepare("PRAGMA table_info(user_inventory)")
      .all()
      .map((row) => (row as { name: string }).name);
    assert.ok(columns.includes("role_status"));
    assert.ok(columns.includes("role_id"));
    // 💾 プラグマは旧実装に合わせる
    assert.equal(store.raw.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(store.raw.pragma("foreign_keys", { simple: true }), 1);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------
// 💾 再オープンで再適用しない
// ------------------------------------------

test("記録済み DB を開き直しても migration は再適用されない", () => {
  const { dir, path } = tempDbPath();
  try {
    // ⏰ 1回目: T1 で開いて、004 の対象になり得る行を入れておく
    const first = openDatabase({ path, hooks: { clock: () => T1 } });
    first.raw
      .prepare(
        "INSERT INTO user_inventory(guild_id, user_id, item_id, purchased_at, role_status, role_id) VALUES('g1', 'u1', 'i1', '2026-11-01T00:00:00.000000000Z', 'pending', '')",
      )
      .run();
    first.close();

    // ⏰ 2回目: T2 で開く。004 が再実行されれば pending → fulfilled に
    // 化けるはずだが、記録済みなので再実行されず pending のまま。
    const second = openDatabase({ path, hooks: { clock: () => T2 } });
    const applied = second.appliedMigrations();
    assert.ok(applied.every((row) => row.applied_at === "2026-11-28T12:00:00.000000000Z"));
    const inventory = second.getInventoryItem("g1", "u1", "i1");
    assert.equal(inventory?.role_status, "pending");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------
// 💾 旧形式 DB（001 / 002 のみ）のアップグレード
// ------------------------------------------

test("001 / 002 のみ適用済みの旧 DB は 003 / 004 で引き上げられる", () => {
  const { dir, path } = tempDbPath();
  try {
    // 🏗️ 旧形式のフィクスチャを手で組む: 001 / 002 を適用して記録し、
    // 003 以前の購入行（role 列なし）を1件入れる。
    const raw = new Database(path);
    raw.pragma("journal_mode = WAL");
    const sql1 = MIGRATIONS.find((m) => m.version === 1)?.sql ?? "";
    const sql2 = MIGRATIONS.find((m) => m.version === 2)?.sql ?? "";
    raw.exec(sql1);
    raw.exec(sql2);
    raw
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?), (2, ?)")
      .run("2026-11-24T00:00:00.000000000Z", "2026-11-24T00:00:00.000000000Z");
    raw
      .prepare(
        "INSERT INTO user_inventory(guild_id, user_id, item_id, purchased_at) VALUES('g1', 'u1', 'legacy-item', '2026-11-25T00:00:00.000000000Z')",
      )
      .run();
    raw.close();

    // 💾 新実装で開く（固定時計 T1 = 2026-11-28 12:00）。
    // 003 が列を足し、004 が「003 適用より前の購入」を fulfilled にする。
    const store = openDatabase({ path, hooks: { clock: () => T1 } });
    assert.deepEqual(
      store.appliedMigrations().map((row) => row.version),
      [1, 2, 3, 4],
    );
    const inventory = store.getInventoryItem("g1", "u1", "legacy-item");
    assert.equal(inventory?.role_status, "fulfilled");
    assert.equal(inventory?.role_id, "");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

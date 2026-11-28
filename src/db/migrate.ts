// ==========================================
// 💾 マイグレーションの実行（schema_migrations 互換）
// ==========================================
// 💾 旧実装（Go）の migrate と同じ手順・同じ意味で適用する。
//
// - 001 / 002 は全面 IF NOT EXISTS のため、記録の有無にかかわらず
//   毎回流しても安全（旧実装も毎回流していた）。
// - 003 / 004 は冪等ではない（ALTER TABLE / 一度きりのバックフィル）
//   ため、schema_migrations に未記録の場合だけ実行する。
// - 適用は全体を1トランザクションで行い、記録も同じ取引で入れる。
//   途中失敗で「適用済みだが未記録」な状態は作らない。
// - 既に 1〜4 が記録済みの DB（本番）では、DDL は何も実行されない。

import type Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations.js";
import { formatUtcTimestamp } from "./context.js";

// ------------------------------------------
// 💾 適用
// ------------------------------------------

// 💾 未適用の migration を適用し、今回適用したバージョンの一覧を返す。
// appliedAt は適用時刻（テストでは時計を固定して渡す）。
export function runMigrations(db: Database.Database, appliedAt: Date): number[] {
  const applied: number[] = [];
  const stamp = formatUtcTimestamp(appliedAt);
  const byVersion = new Map(MIGRATIONS.map((m) => [m.version, m.sql]));

  const apply = db.transaction(() => {
    // 📌 schema_migrations 自体は 001 が作る。先に存在だけ保証する
    // （旧実装は 001 の実行に委ねていたが、記録確認を先に行うため）。
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const recorded = new Set(
      db
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => (row as { version: number }).version),
    );

    for (const version of [1, 2, 3, 4]) {
      const sql = byVersion.get(version);
      if (sql === undefined) throw new Error(`migration ${version} is missing`);
      if (version <= 2) {
        // 💾 001 / 002 は冪等。旧実装と同じく毎回流し、記録は OR IGNORE。
        db.exec(sql);
        db.prepare(
          "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?, ?)",
        ).run(version, stamp);
        if (!recorded.has(version)) applied.push(version);
      } else if (!recorded.has(version)) {
        // ⚠️ 003 / 004 は冪等ではないため、未記録のときだけ実行する。
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)").run(
          version,
          stamp,
        );
        applied.push(version);
      }
    }
  });
  apply();
  return applied;
}

// ------------------------------------------
// 🔍 記録の参照
// ------------------------------------------

// 🔍 schema_migrations の記録をバージョン順に返す。
export function listAppliedMigrations(db: Database.Database): { version: number; applied_at: string }[] {
  return db
    .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version")
    .all() as { version: number; applied_at: string }[];
}

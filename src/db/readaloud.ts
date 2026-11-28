// ==========================================
// 🔊 読み上げ設定・辞書・監査ログのアクセサ
// ==========================================
// 🔊 read_aloud_settings / dictionaries / dictionary_entries /
// audit_logs の読み書き。旧実装（Go の storage.go）の検証条件と
// 監査ログ記録を意味そのままに移したもの。

import type { DbContext } from "./context.js";
import type {
  AuditLogRow,
  DictionaryEntryRow,
  DictionaryRow,
  ReadAloudSettingsRow,
} from "./rows.js";

// ------------------------------------------
// 🧰 スコープの検証（旧 validScope 相当）
// ------------------------------------------

export type Scope = "global" | "guild" | "user";

// 🧰 global は scope_id も "global" 固定。guild / user は ID 必須。
export function validScope(scope: string, scopeId: string): boolean {
  return (
    (scope === "global" && scopeId === "global") ||
    ((scope === "guild" || scope === "user") && scopeId.trim() !== "")
  );
}

function normalizeScope(scope: string, scopeId: string): { scope: string; scopeId: string } {
  return {
    scope: scope === "" ? "global" : scope,
    scopeId: scopeId === "" ? "global" : scopeId,
  };
}

// ------------------------------------------
// 🔊 読み上げ設定
// ------------------------------------------

// 🔊 未保存時の既定設定（旧実装と同じ JSON）。
export const DEFAULT_READ_ALOUD_SETTINGS = `{"enabled":false,"speed":1.0,"volume":1.0,"speaker_id":1}`;

// 🔊 設定と revision を返す。未保存なら既定値と revision 0
// （旧 GetReadAloudSettings 相当）。
export function getReadAloudSettings(
  ctx: DbContext,
  scope: string,
  scopeId: string,
): { settingsJson: string; revision: number } {
  if (!validScope(scope, scopeId)) throw new Error("invalid scope");
  const row = ctx.db
    .prepare(
      "SELECT settings_json, revision FROM read_aloud_settings WHERE scope = ? AND scope_id = ?",
    )
    .get(scope, scopeId) as Pick<ReadAloudSettingsRow, "settings_json" | "revision"> | undefined;
  if (row === undefined) return { settingsJson: DEFAULT_READ_ALOUD_SETTINGS, revision: 0 };
  return { settingsJson: row.settings_json, revision: row.revision };
}

// 🔊 設定行をそのまま取得する（無ければ null）。
export function getReadAloudSettingsRow(
  ctx: DbContext,
  scope: string,
  scopeId: string,
): ReadAloudSettingsRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM read_aloud_settings WHERE scope = ? AND scope_id = ?")
      .get(scope, scopeId) as ReadAloudSettingsRow | undefined) ?? null
  );
}

// 🔊 設定を保存し、新しい revision を返す（旧 PutReadAloudSettings 相当）。
// 検証条件（speed 0.5〜2.0、volume 0.0〜2.0、speaker_id 0〜100000）と
// 監査ログへの記録も旧実装に合わせる。
export function putReadAloudSettings(
  ctx: DbContext,
  scope: string,
  scopeId: string,
  settingsJson: string,
  actor: string,
): number {
  if (!validScope(scope, scopeId)) throw new Error("invalid scope");
  let parsed: {
    enabled?: unknown;
    speed?: unknown;
    volume?: unknown;
    speaker_id?: unknown;
  };
  try {
    parsed = JSON.parse(settingsJson) as typeof parsed;
  } catch {
    throw new Error("settings must be valid JSON");
  }
  if (
    typeof parsed.enabled !== "boolean" ||
    typeof parsed.speed !== "number" ||
    typeof parsed.volume !== "number" ||
    typeof parsed.speaker_id !== "number"
  ) {
    throw new Error("settings require enabled, speed, volume and speaker_id");
  }
  if (!Number.isFinite(parsed.speed) || parsed.speed < 0.5 || parsed.speed > 2.0) {
    throw new Error("speed must be between 0.5 and 2.0");
  }
  if (!Number.isFinite(parsed.volume) || parsed.volume < 0.0 || parsed.volume > 2.0) {
    throw new Error("volume must be between 0.0 and 2.0");
  }
  if (!Number.isInteger(parsed.speaker_id) || parsed.speaker_id < 0 || parsed.speaker_id > 100000) {
    throw new Error("speaker_id must be between 0 and 100000");
  }
  const run = ctx.db.transaction((): number => {
    ctx.db
      .prepare(
        `INSERT INTO read_aloud_settings(scope, scope_id, settings_json, revision, updated_at) VALUES(?, ?, ?, 1, ?)
         ON CONFLICT(scope, scope_id) DO UPDATE SET settings_json = excluded.settings_json,
           revision = read_aloud_settings.revision + 1, updated_at = excluded.updated_at`,
      )
      .run(scope, scopeId, settingsJson, ctx.now());
    const row = getReadAloudSettingsRow(ctx, scope, scopeId);
    const revision = row?.revision ?? 1;
    appendAuditLog(ctx, {
      actor,
      action: "read_aloud_settings.update",
      target: `${scope}:${scopeId}`,
      detailsJson: `{"revision":${revision}}`,
    });
    return revision;
  });
  return run();
}

// ------------------------------------------
// 📖 辞書
// ------------------------------------------

// 📖 スコープの辞書ヘッダーを取得する（無ければ null）。
export function getDictionary(ctx: DbContext, scope: string, scopeId: string): DictionaryRow | null {
  const s = normalizeScope(scope, scopeId);
  return (
    (ctx.db
      .prepare("SELECT * FROM dictionaries WHERE scope = ? AND scope_id = ?")
      .get(s.scope, s.scopeId) as DictionaryRow | undefined) ?? null
  );
}

// 📖 全辞書ヘッダーを返す。
export function listDictionaries(ctx: DbContext): DictionaryRow[] {
  return ctx.db
    .prepare("SELECT * FROM dictionaries ORDER BY scope, scope_id")
    .all() as DictionaryRow[];
}

export interface DictionaryEntry {
  entryId: string;
  word: string;
  reading: string;
}

// 📖 スコープの辞書エントリを単語順に返す（旧 ListDictionary 相当）。
export function listDictionaryEntries(
  ctx: DbContext,
  scope: string,
  scopeId: string,
): DictionaryEntry[] {
  const s = normalizeScope(scope, scopeId);
  const rows = ctx.db
    .prepare(
      `SELECT entry_id, word, reading FROM dictionary_entries
       WHERE scope = ? AND scope_id = ? ORDER BY word COLLATE NOCASE`,
    )
    .all(s.scope, s.scopeId) as Pick<DictionaryEntryRow, "entry_id" | "word" | "reading">[];
  return rows.map((row) => ({ entryId: row.entry_id, word: row.word, reading: row.reading }));
}

// 📖 スコープの辞書エントリ全件を行のまま返す。
export function listDictionaryEntryRows(
  ctx: DbContext,
  scope: string,
  scopeId: string,
): DictionaryEntryRow[] {
  const s = normalizeScope(scope, scopeId);
  return ctx.db
    .prepare("SELECT * FROM dictionary_entries WHERE scope = ? AND scope_id = ? ORDER BY word")
    .all(s.scope, s.scopeId) as DictionaryEntryRow[];
}

// 📖 辞書エントリを追加・更新する（旧 PutDictionaryEntry 相当）。
// 辞書ヘッダーが無ければ作り、revision を進め、監査ログに残す。
export function putDictionaryEntry(
  ctx: DbContext,
  args: { scope: string; scopeId: string; word: string; reading: string; actor: string },
): void {
  const s = normalizeScope(args.scope, args.scopeId);
  if (
    !validScope(s.scope, s.scopeId) ||
    args.word.trim() === "" ||
    args.reading.trim() === "" ||
    args.word.length > 512 ||
    args.reading.length > 512
  ) {
    throw new Error("valid scope, word and reading are required");
  }
  const run = ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT OR IGNORE INTO dictionaries(dictionary_id, scope, scope_id, revision, created_at, updated_at)
         VALUES(?, ?, ?, 1, ?, ?)`,
      )
      .run(ctx.randomId("dict_"), s.scope, s.scopeId, ctx.now(), ctx.now());
    const dictionary = getDictionary(ctx, s.scope, s.scopeId);
    if (dictionary === null) throw new Error("dictionary header is missing");
    ctx.db
      .prepare(
        `INSERT INTO dictionary_entries(entry_id, dictionary_id, scope, scope_id, word, reading, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope, scope_id, word) DO UPDATE SET reading = excluded.reading,
           updated_at = excluded.updated_at`,
      )
      .run(
        ctx.randomId("entry_"),
        dictionary.dictionary_id,
        s.scope,
        s.scopeId,
        args.word,
        args.reading,
        ctx.now(),
        ctx.now(),
      );
    ctx.db
      .prepare("UPDATE dictionaries SET revision = revision + 1, updated_at = ? WHERE dictionary_id = ?")
      .run(ctx.now(), dictionary.dictionary_id);
    appendAuditLog(ctx, {
      actor: args.actor,
      action: "dictionary.upsert",
      target: `${s.scope}:${s.scopeId}:${args.word}`,
      detailsJson: `{"updated":true}`,
    });
  });
  run();
}

// 📖 辞書エントリを削除する。
export function deleteDictionaryEntry(
  ctx: DbContext,
  scope: string,
  scopeId: string,
  word: string,
): void {
  const s = normalizeScope(scope, scopeId);
  ctx.db
    .prepare("DELETE FROM dictionary_entries WHERE scope = ? AND scope_id = ? AND word = ?")
    .run(s.scope, s.scopeId, word);
}

// ------------------------------------------
// 📝 監査ログ
// ------------------------------------------

// 📝 監査ログを1件追加し、採番された id を返す。
export function appendAuditLog(
  ctx: DbContext,
  entry: { actor: string; action: string; target?: string; detailsJson?: string },
): number {
  const result = ctx.db
    .prepare(
      "INSERT INTO audit_logs(actor, action, target, details_json, created_at) VALUES(?, ?, ?, ?, ?)",
    )
    .run(entry.actor, entry.action, entry.target ?? "", entry.detailsJson ?? "{}", ctx.now());
  return Number(result.lastInsertRowid);
}

// 📝 監査ログを新しい順に返す（件数指定可）。
export function listAuditLogs(ctx: DbContext, limit = 100): AuditLogRow[] {
  return ctx.db
    .prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?")
    .all(limit) as AuditLogRow[];
}

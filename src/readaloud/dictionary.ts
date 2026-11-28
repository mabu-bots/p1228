// ==========================================
// 📖 共有辞書の合成と適用
// ==========================================
// 📖 辞書（単語 → 読み）は dictionary_entries にスコープ別に保存され、
// 再生前に Global → Guild → User の順で合成して本文へ適用する
// （旧 Worker の applyDictionary と同じ意味）。
// 同じ単語は上位スコープ（User 側）が勝ち、置換は長い単語から
// 行うことで、短い単語の部分一致で長い単語が壊れないようにする。
// DB への依存は DictionarySource インターフェースに閉じる。

import { createHash } from "node:crypto";
import type { DictionaryEntry } from "../db/index.js";

// ------------------------------------------
// 📖 辞書の供給元
// ------------------------------------------

// 📖 辞書エントリの供給元（Store が構造的に満たす）。
export interface DictionarySource {
  listDictionaryEntries(scope: string, scopeId: string): DictionaryEntry[];
}

export interface ResolvedDictionary {
  // 📖 合成済みエントリ（置換順: 単語の長い順 → 単語順）
  entries: DictionaryEntry[];
  // 📖 エントリ内容の SHA-256（音声キャッシュのキー用）
  revision: string;
}

// ------------------------------------------
// 📖 合成と適用
// ------------------------------------------

// 📖 3スコープのエントリを集める。引数の並び（下位 → 上位）の
// 順に後勝ちで単語ごとに上書きする。
export function mergeDictionaryEntries(
  scopedEntries: readonly (readonly DictionaryEntry[])[],
): DictionaryEntry[] {
  const byWord = new Map<string, DictionaryEntry>();
  for (const entries of scopedEntries) {
    for (const entry of entries) byWord.set(entry.word, entry);
  }
  return [...byWord.values()].sort(
    (a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word),
  );
}

// 📖 エントリ集合の revision を作る（内容が変わればキーも変わる）。
export function dictionaryRevision(entries: readonly DictionaryEntry[]): string {
  const body = JSON.stringify(entries.map((entry) => ({ word: entry.word, reading: entry.reading })));
  return createHash("sha256").update(body).digest("hex");
}

// 📖 Global → Guild → User の辞書を合成して返す。
export function resolveDictionary(
  source: DictionarySource,
  guildId: string,
  userId?: string,
): ResolvedDictionary {
  const entries = mergeDictionaryEntries([
    source.listDictionaryEntries("global", "global"),
    source.listDictionaryEntries("guild", guildId),
    ...(userId ? [source.listDictionaryEntries("user", userId)] : []),
  ]);
  return { entries, revision: dictionaryRevision(entries) };
}

// 📖 辞書を本文へ適用する（全出現を置換。旧実装の replaceAll と同じ）。
export function applyDictionary(text: string, entries: readonly DictionaryEntry[]): string {
  let value = text;
  for (const entry of entries) {
    if (entry.word) value = value.replaceAll(entry.word, entry.reading);
  }
  return value;
}

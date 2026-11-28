// ==========================================
// 🧪 共有辞書の合成と適用のテスト
// ==========================================
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DictionaryEntry } from "../src/db/index.js";
import {
  applyDictionary,
  mergeDictionaryEntries,
  resolveDictionary,
  type DictionarySource,
} from "../src/readaloud/dictionary.js";

function entry(word: string, reading: string): DictionaryEntry {
  return { entryId: `entry_${word}`, word, reading };
}

test("merge: later scopes win for the same word", () => {
  const merged = mergeDictionaryEntries([
    [entry("猫", "ねこ"), entry("犬", "いぬ")],
    [entry("猫", "にゃんこ")],
    [],
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((e) => e.word === "猫")?.reading, "にゃんこ");
  assert.equal(merged.find((e) => e.word === "犬")?.reading, "いぬ");
});

test("merge: entries are sorted longest word first", () => {
  const merged = mergeDictionaryEntries([[entry("A", "えー"), entry("ABC", "えーびーしー"), entry("AB", "えーびー")]]);
  assert.deepEqual(
    merged.map((e) => e.word),
    ["ABC", "AB", "A"],
  );
});

test("apply: longest match wins and every occurrence is replaced", () => {
  const entries = mergeDictionaryEntries([[entry("A", "えー"), entry("AB", "えーびー"), entry("猫", "ねこ")]]);
  assert.equal(applyDictionary("ABとAと猫、猫", entries), "えーびーとえーとねこ、ねこ");
});

test("resolve: revision is stable for same content and changes with content", () => {
  const source: DictionarySource = {
    listDictionaryEntries(scope: string, scopeId: string) {
      if (scope === "global") return [entry("猫", "ねこ")];
      if (scope === "guild" && scopeId === "g1") return [entry("犬", "いぬ")];
      return [];
    },
  };
  const first = resolveDictionary(source, "g1", "u1");
  const second = resolveDictionary(source, "g1", "u1");
  assert.equal(first.revision, second.revision);
  assert.equal(first.entries.length, 2);

  const changed: DictionarySource = {
    listDictionaryEntries(scope: string) {
      if (scope === "global") return [entry("猫", "にゃんこ")];
      return [];
    },
  };
  assert.notEqual(resolveDictionary(changed, "g1").revision, resolveDictionary(source, "g1").revision);
});

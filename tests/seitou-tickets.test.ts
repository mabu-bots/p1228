// ==========================================
// 🧪 星燈グループ (d) チケットの純粋ロジックのテスト
// ==========================================
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTranscriptLines, chunkTranscript, privateOverwrites, privateVoiceOverwrites } from "../src/seitou/tickets.js";

test("privateOverwrites: 全体は閲覧不可、本人と担当は読み書き可", () => {
  assert.deepEqual(privateOverwrites("g1", "u1", "r1"), [
    { id: "g1", type: 0, allow: "0", deny: "1024" },
    { id: "u1", type: 1, allow: "3072", deny: "0" },
    { id: "r1", type: 0, allow: "3072", deny: "0" },
  ]);
});

test("privateVoiceOverwrites: 指定した相手だけ CONNECT を拒否する", () => {
  const overwrites = privateVoiceOverwrites("g1", "u1", "r1", "u2");
  assert.deepEqual(overwrites[0], { id: "g1", type: 0, allow: "0", deny: "1049600" });
  assert.deepEqual(overwrites[1], { id: "u1", type: 1, allow: "3146752", deny: "0" });
  assert.deepEqual(overwrites[2], { id: "r1", type: 0, allow: "3146752", deny: "0" });
  // 🚫 1048576 = CONNECT のみ拒否。
  assert.deepEqual(overwrites[3], { id: "u2", type: 1, allow: "0", deny: "1048576" });
});

test("chunkTranscript: 改行位置で分け、上限を超えない", () => {
  const text = Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\n");
  const chunks = chunkTranscript(text, 50);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 50, chunk);
  assert.equal(chunks.join("\n"), text);
  assert.deepEqual(chunkTranscript(""), []);
  assert.deepEqual(chunkTranscript("abc"), ["abc"]);
  // 📌 改行が無い長い本文はサイズで切る。
  const hard = chunkTranscript("x".repeat(120), 50);
  assert.deepEqual(hard.map((chunk) => chunk.length), [50, 50, 20]);
});

test("buildTranscriptLines: 本文のあるものだけを整形する", () => {
  const lines = buildTranscriptLines([
    { timestamp: "2026-11-28T00:00:00.000Z", authorName: "たろう", content: "相談です" },
    { timestamp: "2026-11-28T00:01:00.000Z", authorName: "運営", content: "  " },
    { timestamp: "2026-11-28T00:02:00.000Z", authorName: "運営", content: "承知しました" },
  ]);
  assert.deepEqual(lines, [
    "[2026-11-28T00:00:00.000Z] たろう: 相談です",
    "[2026-11-28T00:02:00.000Z] 運営: 承知しました",
  ]);
});

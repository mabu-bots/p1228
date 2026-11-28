// ==========================================
// 🧪 星燈グループ (e) /ai のテスト
// ==========================================
import assert from "node:assert/strict";
import { test } from "node:test";
import { AiBusyError, buildAiRequestBody, chatWithAi, extractAiContent, isAiBusy } from "../src/seitou/ai.js";

test("buildAiRequestBody: system + user と生成パラメータ", () => {
  const body = buildAiRequestBody("こんにちは") as {
    messages: { role: string; content: string }[];
    max_tokens: number;
    temperature: number;
  };
  assert.equal(body.messages[0]!.role, "system");
  assert.ok(body.messages[0]!.content.includes("星燈"));
  assert.deepEqual(body.messages[1], { role: "user", content: "こんにちは" });
  assert.equal(body.max_tokens, 400);
  assert.equal(body.temperature, 0.7);
});

test("extractAiContent: 本文を取り出し、空応答は例外", () => {
  assert.equal(extractAiContent({ choices: [{ message: { content: "回答" } }] }), "回答");
  assert.throws(() => extractAiContent({ choices: [{ message: { content: "  " } }] }), /empty response/);
  assert.throws(() => extractAiContent({ choices: [] }), /empty response/);
  assert.throws(() => extractAiContent(null), /empty response/);
});

test("chatWithAi: 疑似 fetch で往復し、同時実行は AiBusyError", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: { url: string; body: unknown }[] = [];
  const fakeFetch = (async (url: string, init: { body: string }) => {
    seen.push({ url, body: JSON.parse(init.body) });
    await gate;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "やあ" } }] }),
    } as Response;
  }) as unknown as typeof fetch;

  const pending = chatWithAi("http://llama.test", "質問", fakeFetch);
  assert.equal(isAiBusy(), true);
  await assert.rejects(chatWithAi("http://llama.test", "もう一つ", fakeFetch), AiBusyError);
  release();
  assert.equal(await pending, "やあ");
  assert.equal(isAiBusy(), false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "http://llama.test/v1/chat/completions");
});

test("chatWithAi: HTTP エラーと空プロンプトは例外", async () => {
  const failing = (async () =>
    ({ ok: false, status: 500, json: async () => ({}) }) as Response) as unknown as typeof fetch;
  await assert.rejects(chatWithAi("http://llama.test", "質問", failing), /HTTP 500/);
  assert.equal(isAiBusy(), false);
  await assert.rejects(chatWithAi("http://llama.test", "  "), /prompt is empty/);
});

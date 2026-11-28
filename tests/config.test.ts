// ==========================================
// 🧪 設定読み込みのテスト
// ==========================================
import assert from "node:assert/strict";
import { test } from "node:test";
import { BOT_IDS, loadConfig, missingTokenBots, selectBotIds } from "../src/config.js";

test("defaults: tokens are null and shared settings fall back", () => {
  const config = loadConfig({});
  assert.equal(config.bots.general.token, null);
  assert.equal(config.bots.read_aloud_a.token, null);
  assert.equal(config.bots.read_aloud_b.token, null);
  assert.equal(config.dbPath, "data/p1228.sqlite3");
  assert.equal(config.voicevoxBaseUrl, "http://127.0.0.1:50021");
  assert.equal(config.audioCacheDir, "data/audio-cache");
  assert.equal(config.audioCacheMaxMb, 512);
  assert.equal(config.audioCacheTtlHours, 24);
  assert.equal(config.llamaBaseUrl, "http://127.0.0.1:8080");
  assert.equal(config.alertWebhookUrl, null);
});

test("bot display names and token env names are wired", () => {
  const config = loadConfig({});
  assert.equal(config.bots.general.displayName, "星燈");
  assert.equal(config.bots.read_aloud_a.displayName, "言ノ葉");
  assert.equal(config.bots.read_aloud_b.displayName, "紡言");
  assert.equal(config.bots.general.tokenEnvName, "P1228_GENERAL_TOKEN");
  assert.equal(config.bots.read_aloud_a.tokenEnvName, "P1228_READ_ALOUD_A_TOKEN");
  assert.equal(config.bots.read_aloud_b.tokenEnvName, "P1228_READ_ALOUD_B_TOKEN");
});

test("tokens are read per bot and trimmed; blank counts as unset", () => {
  const config = loadConfig({
    P1228_GENERAL_TOKEN: "  token-general  ",
    P1228_READ_ALOUD_A_TOKEN: "token-a",
    P1228_READ_ALOUD_B_TOKEN: "   ",
  });
  assert.equal(config.bots.general.token, "token-general");
  assert.equal(config.bots.read_aloud_a.token, "token-a");
  assert.equal(config.bots.read_aloud_b.token, null);
});

test("base URLs have trailing slashes stripped", () => {
  const config = loadConfig({
    VOICEVOX_BASE_URL: "http://127.0.0.1:50021/",
    LLAMA_BASE_URL: "http://127.0.0.1:8080///",
  });
  assert.equal(config.voicevoxBaseUrl, "http://127.0.0.1:50021");
  assert.equal(config.llamaBaseUrl, "http://127.0.0.1:8080");
});

test("numeric settings parse valid values and reject invalid ones", () => {
  const config = loadConfig({ P1228_AUDIO_CACHE_MAX_MB: "1024", P1228_AUDIO_CACHE_TTL_HOURS: "48" });
  assert.equal(config.audioCacheMaxMb, 1024);
  assert.equal(config.audioCacheTtlHours, 48);
  assert.throws(() => loadConfig({ P1228_AUDIO_CACHE_MAX_MB: "0" }), /P1228_AUDIO_CACHE_MAX_MB/);
  assert.throws(() => loadConfig({ P1228_AUDIO_CACHE_TTL_HOURS: "abc" }), /P1228_AUDIO_CACHE_TTL_HOURS/);
});

test("selectBotIds: no argument or 'all' selects every bot", () => {
  assert.deepEqual(selectBotIds([]), [...BOT_IDS]);
  assert.deepEqual(selectBotIds(["all"]), [...BOT_IDS]);
});

test("selectBotIds: a single bot id selects only that bot", () => {
  assert.deepEqual(selectBotIds(["general"]), ["general"]);
  assert.deepEqual(selectBotIds(["read_aloud_b"]), ["read_aloud_b"]);
});

test("selectBotIds: an unknown value throws", () => {
  assert.throws(() => selectBotIds(["gateway"]), /不明な Bot 指定/);
});

test("watching phrases match the presence spec (DESIGN 3.2)", () => {
  const config = loadConfig({});
  assert.equal(config.bots.general.watching, "サーバーを見守り中");
  assert.equal(config.bots.read_aloud_a.watching, "言葉を紡ぎ中");
  assert.equal(config.bots.read_aloud_b.watching, "声をお届け中");
});

test("missingTokenBots returns only the bots without a token", () => {
  const config = loadConfig({ P1228_GENERAL_TOKEN: "token-general" });
  const missing = missingTokenBots(config, BOT_IDS);
  assert.deepEqual(
    missing.map((bot) => bot.id),
    ["read_aloud_a", "read_aloud_b"],
  );
  assert.deepEqual(missingTokenBots(config, ["general"]), []);
});

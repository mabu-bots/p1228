// ==========================================
// 🧪 星燈グループ (a) の純粋ロジックのテスト
// ==========================================
// 🧪 autorole の正規化・解決・表示と、VC ログのキー対応・送信先
// 解決の優先順位を固定する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAutoRoleSettings, normalizeAutoRole, resolveAutoRoleId } from "../src/seitou/autorole.js";
import { resolveVoiceLogChannel, voiceLogSettingKey } from "../src/seitou/voice-log.js";
import type { StarSettingsMap } from "../src/seitou/settings.js";

function settingsOf(entries: Record<string, unknown>): StarSettingsMap {
  return new Map(Object.entries(entries));
}

// ------------------------------------------
// 🎭 自動ロール
// ------------------------------------------

test("normalizeAutoRole: 旧形式 role_id はユーザー用へ読み替える", () => {
  assert.deepEqual(normalizeAutoRole({ role_id: "r-old" }), { user_role_id: "r-old" });
  assert.deepEqual(normalizeAutoRole({ user_role_id: "r-u", bot_role_id: "r-b" }), {
    user_role_id: "r-u",
    bot_role_id: "r-b",
  });
  // 📌 新形式があれば旧形式より優先する。
  assert.deepEqual(normalizeAutoRole({ user_role_id: "r-u", role_id: "r-old" }), { user_role_id: "r-u" });
  assert.deepEqual(normalizeAutoRole(null), {});
  assert.deepEqual(normalizeAutoRole(undefined), {});
});

test("resolveAutoRoleId: ユーザーと Bot で解決先が分かれる", () => {
  const settings = settingsOf({ autorole: { user_role_id: "r-u", bot_role_id: "r-b" } });
  assert.equal(resolveAutoRoleId(settings, false), "r-u");
  assert.equal(resolveAutoRoleId(settings, true), "r-b");
  // 📌 旧形式は Bot には適用しない。
  const legacy = settingsOf({ autorole: { role_id: "r-old" } });
  assert.equal(resolveAutoRoleId(legacy, false), "r-old");
  assert.equal(resolveAutoRoleId(legacy, true), "");
  assert.equal(resolveAutoRoleId(settingsOf({}), false), "");
});

test("formatAutoRoleSettings: 設定あり・未設定の表示", () => {
  assert.equal(
    formatAutoRoleSettings(settingsOf({ autorole: { user_role_id: "r-u" } })),
    "ユーザー用: <@&r-u> / Bot用: 未設定",
  );
  assert.equal(formatAutoRoleSettings(settingsOf({})), "ユーザー用: 未設定 / Bot用: 未設定");
});

// ------------------------------------------
// 🔊 VC ログ
// ------------------------------------------

test("voiceLogSettingKey: 種別と対象IDからキーを作る", () => {
  assert.equal(voiceLogSettingKey("voice", ""), "voice");
  assert.equal(voiceLogSettingKey("voice_join", ""), "voice.join");
  assert.equal(voiceLogSettingKey("voice_leave", ""), "voice.leave");
  assert.equal(voiceLogSettingKey("voice_category", "cat1"), "voice.category.cat1");
  assert.equal(voiceLogSettingKey("voice_category_join", "cat1"), "voice.category.cat1.join");
  assert.equal(voiceLogSettingKey("voice_category_leave", "cat1"), "voice.category.cat1.leave");
  assert.equal(voiceLogSettingKey("voice_channel", "ch1"), "voice.channel.ch1");
  assert.equal(voiceLogSettingKey("message_edit", ""), "message_edit");
  // 📌 対象IDが必要な種別で未指定なら空文字（呼び出し側でエラー）。
  assert.equal(voiceLogSettingKey("voice_category", ""), "");
  assert.equal(voiceLogSettingKey("voice_channel", ""), "");
});

test("resolveVoiceLogChannel: チャンネル別→カテゴリー別→全体の優先順位", () => {
  const settings = settingsOf({
    "log.voice": "all",
    "log.voice.join": "all-join",
    "log.voice.category.cat1": "cat",
    "log.voice.category.cat1.join": "cat-join",
    "log.voice.channel.ch1": "ch",
    "log.voice.channel.ch1.join": "ch-join",
  });
  assert.equal(resolveVoiceLogChannel(settings, "ch1", "cat1", "join"), "ch-join");
  assert.equal(resolveVoiceLogChannel(settings, "ch1", "cat1", "leave"), "ch");
  assert.equal(resolveVoiceLogChannel(settings, "ch2", "cat1", "join"), "cat-join");
  assert.equal(resolveVoiceLogChannel(settings, "ch2", "cat1", "leave"), "cat");
  assert.equal(resolveVoiceLogChannel(settings, "ch2", "cat2", "join"), "all-join");
  assert.equal(resolveVoiceLogChannel(settings, "ch2", "cat2", "leave"), "all");
  assert.equal(resolveVoiceLogChannel(settings, "ch2", "", "join"), "all-join");
  assert.equal(resolveVoiceLogChannel(settingsOf({}), "ch1", "cat1", "join"), "");
});

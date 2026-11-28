// ==========================================
// 🧪 星燈の土台（ロガー・共有ヘルパー・設定・状態）のテスト
// ==========================================
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatExecLog } from "../src/logger.js";
import { StarSettings } from "../src/seitou/settings.js";
import { SeitouState } from "../src/seitou/state.js";
import {
  expectedGameErrorMessage,
  formatMemberMessage,
  hasServerAdminPermission,
  isAdminCommand,
  truncateToCodePoints,
} from "../src/seitou/shared.js";
import { openDatabase } from "../src/db/index.js";

// ------------------------------------------
// 📝 [exec] ログ形式
// ------------------------------------------

test("formatExecLog: 成功時は result=ok で ID を並べる", () => {
  const line = formatExecLog(new Date("2026-11-28T12:00:00.000Z"), "points", "g1", "c1", "u1");
  assert.equal(
    line,
    "[exec] 2026-11-28T12:00:00.000Z cmd=points route=slash guild=g1 channel=c1 user=u1 result=ok",
  );
});

test("formatExecLog: 失敗時は error を要約し、欠けた ID は - にする", () => {
  const line = formatExecLog(
    new Date("2026-11-28T12:00:00.000Z"),
    "buy",
    undefined,
    "",
    undefined,
    new Error('something "bad"\nhappened'),
  );
  assert.equal(
    line,
    `[exec] 2026-11-28T12:00:00.000Z cmd=buy route=slash guild=- channel=- user=- result=error error="something 'bad' happened"`,
  );
});

// ------------------------------------------
// 🔐 権限判定
// ------------------------------------------

test("hasServerAdminPermission: Administrator / Manage Server のどちらかで可", () => {
  assert.equal(hasServerAdminPermission(8n), true);
  assert.equal(hasServerAdminPermission(32n), true);
  assert.equal(hasServerAdminPermission(8n | 1024n), true);
  assert.equal(hasServerAdminPermission(1024n), false);
  assert.equal(hasServerAdminPermission(0n), false);
  assert.equal(hasServerAdminPermission(null), false);
  assert.equal(hasServerAdminPermission(undefined), false);
});

test("isAdminCommand: 一般コマンドと shop list / ticket close は一般可", () => {
  for (const name of ["omikuji", "points", "lottery", "buy", "ai"]) {
    assert.equal(isAdminCommand(name, ""), false, name);
  }
  assert.equal(isAdminCommand("shop", "list"), false);
  assert.equal(isAdminCommand("shop", "add"), true);
  assert.equal(isAdminCommand("ticket", "close"), false);
  assert.equal(isAdminCommand("ticket", "panel"), true);
  assert.equal(isAdminCommand("welcome", "set"), true);
  assert.equal(isAdminCommand("tsukigakure", "room"), true);
});

// ------------------------------------------
// ✉️ 文言整形
// ------------------------------------------

test("formatMemberMessage: placeholder を置換する", () => {
  const text = formatMemberMessage("{user} さん、{server} へようこそ！（{username} / {user_id}）", "42", "taro", "夜凪鯖");
  assert.equal(text, "<@42> さん、夜凪鯖 へようこそ！（taro / 42）");
});

test("formatMemberMessage: 2,000コードポイントで切り詰める", () => {
  const text = formatMemberMessage("あ".repeat(3000), "1", "u", "s");
  assert.equal(Array.from(text).length, 2000);
});

test("truncateToCodePoints: サロゲートペアを割らない", () => {
  assert.equal(truncateToCodePoints("a𐮷b", 2), "a𐮷");
});

// ------------------------------------------
// 🎮 ゲーム系エラーの文面対応
// ------------------------------------------

test("expectedGameErrorMessage: 既知エラーを文面へ、未知は undefined", () => {
  assert.equal(expectedGameErrorMessage(new Error("insufficient points")), "ポイントが足りません。");
  assert.equal(
    expectedGameErrorMessage(new Error("omikuji already drawn today")),
    "おみくじは本日すでに引いています。",
  );
  assert.equal(expectedGameErrorMessage(new Error("shop item already owned")), "この商品はすでに購入済みです。");
  assert.equal(expectedGameErrorMessage(new Error("shop item not found")), "商品が見つかりません。");
  assert.equal(expectedGameErrorMessage(new Error("boom")), undefined);
});

// ------------------------------------------
// ⚙️ 設定（StarSettings）
// ------------------------------------------

test("StarSettings: 保存・取得・無効化と、旧形式 null の読み替え", () => {
  const store = openDatabase({ path: ":memory:" });
  try {
    const settings = new StarSettings(store);
    assert.equal(settings.get("g1", "autorole", null), null);

    settings.set("g1", "autorole", { user_role_id: "r1" });
    assert.deepEqual(settings.get("g1", "autorole", null), { user_role_id: "r1" });

    // 📝 旧実装が書いた JSON null の行は「未設定」として読める。
    store.setGuildFeatureSetting("g1", "member_join", "null");
    assert.equal(settings.get("g1", "member_join", null), null);

    // 📝 無効化はキー削除になる。
    settings.set("g1", "autorole", null);
    assert.equal(settings.get("g1", "autorole", null), null);
    assert.equal(store.getGuildFeatureSettings("g1").has("autorole"), false);

    // 📝 文字列値（ログ送信先）の往復。
    settings.set("g1", "log.message_edit", "c9");
    assert.equal(settings.get("g1", "log.message_edit", ""), "c9");
  } finally {
    store.close();
  }
});

// ------------------------------------------
// 🗂️ 状態（SeitouState）
// ------------------------------------------

test("SeitouState: 在室数カウントとギルド単位の破棄", () => {
  const state = new SeitouState();
  state.voiceChannels.set("g1:u1", "vc1");
  state.voiceChannels.set("g1:u2", "vc1");
  state.voiceChannels.set("g1:u3", "vc2");
  state.voiceChannels.set("g2:u1", "vc1");
  assert.equal(state.countOccupants("g1", "vc1"), 2);
  assert.equal(state.countOccupants("g1", "vc2"), 1);
  assert.equal(state.countOccupants("g1", "none"), 0);

  state.setMemberName("g1", "u1", "たろう");
  assert.equal(state.memberName("g1", "u1", "?"), "たろう");
  assert.equal(state.memberName("g1", "u9", "?"), "?");

  state.guildNames.set("g1", "夜凪鯖");
  state.memberRoles.set("g1:u1", new Set(["r1"]));
  state.channelParents.set("g1:vc1", "cat1");
  state.clearGuild("g1");
  assert.equal(state.guildNames.has("g1"), false);
  assert.equal(state.memberRoles.size, 0);
  assert.equal(state.channelParents.size, 0);
  // 🔊 他ギルドの音声状態は残る。
  assert.equal(state.voiceChannels.size, 1);
  assert.equal(state.countOccupants("g2", "vc1"), 1);
});

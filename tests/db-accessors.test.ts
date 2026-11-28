// ==========================================
// 💾 DB 層テスト: 全テーブルの読み書き
// ==========================================
// 💾 フィクスチャ DB（migration 適用済み）に対して、25テーブル全てを
// アクセサ経由で読み書きする。時計は可変の固定時計、ID と乱数は
// 決定的なものに差し替える。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Store } from "../src/db/index.js";

// ------------------------------------------
// 🧰 フィクスチャ
// ------------------------------------------

interface Fixture {
  store: Store;
  // 🕐 固定時計を進める
  advanceMs: (ms: number) => void;
  setRandomInt: (value: number) => void;
  cleanup: () => void;
}

function openFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "p1228-db-test-"));
  let current = new Date("2026-11-28T12:00:00.000Z");
  let idCounter = 0;
  let randomValue = 0;
  const store = openDatabase({
    path: join(dir, "test.sqlite3"),
    hooks: {
      clock: () => current,
      randomId: (prefix: string) => `${prefix}test-${++idCounter}`,
      randomInt: () => randomValue,
    },
  });
  return {
    store,
    advanceMs: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
    setRandomInt: (value: number) => {
      randomValue = value;
    },
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ------------------------------------------
// 🧱 基盤テーブル
// ------------------------------------------

test("bots / guilds / users の登録と取得", () => {
  const f = openFixture();
  try {
    f.store.upsertBot({ botId: "general", displayName: "星燈", applicationId: "app-1" });
    assert.equal(f.store.getBot("general")?.display_name, "星燈");
    f.store.setBotEnabled("general", false);
    assert.equal(f.store.getBot("general")?.enabled, 0);
    assert.equal(f.store.listBots().length, 1);
    assert.equal(f.store.getBot("missing"), null);

    f.store.upsertGuild({ guildId: "g1", name: "夜凪鯖" });
    f.store.upsertGuild({ guildId: "g1", name: "夜凪鯖・改" });
    assert.equal(f.store.getGuild("g1")?.name, "夜凪鯖・改");
    assert.equal(f.store.listGuilds().length, 1);

    f.store.upsertUser({ userId: "u1", username: "mabu" });
    assert.equal(f.store.getUser("u1")?.username, "mabu");
    assert.equal(f.store.listUsers().length, 1);
  } finally {
    f.cleanup();
  }
});

test("guild_settings / user_settings / audio_engine_settings の revision 付き保存", () => {
  const f = openFixture();
  try {
    // 🔗 guild_settings は guilds への外部キーがあるため先に登録する
    assert.throws(() => f.store.putGuildSettings("ghost", "{}"));
    f.store.upsertGuild({ guildId: "g1", name: "夜凪鯖" });
    f.store.upsertUser({ userId: "u1", username: "mabu" });

    assert.equal(f.store.putGuildSettings("g1", `{"welcome":true}`), 1);
    assert.equal(f.store.putGuildSettings("g1", `{"welcome":false}`), 2);
    assert.equal(f.store.getGuildSettings("g1")?.settings_json, `{"welcome":false}`);
    assert.equal(f.store.getGuildSettings("none"), null);

    assert.equal(f.store.putUserSettings("u1", `{"lang":"ja"}`), 1);
    assert.equal(f.store.getUserSettings("u1")?.revision, 1);

    assert.equal(f.store.putAudioEngineSettings("voicevox", `{"speaker":1}`), 1);
    assert.equal(f.store.getAudioEngineSettings("voicevox")?.config_json, `{"speaker":1}`);
    assert.equal(f.store.listAudioEngineSettings().length, 1);
    assert.throws(() => f.store.putAudioEngineSettings("voicevox", "not-json"));
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------
// ⭐ 機能設定・ブラックリスト・スティッキー
// ------------------------------------------

test("guild_feature_settings とブラックリスト", () => {
  const f = openFixture();
  try {
    f.store.setGuildFeatureSetting("g1", "points", `{"rate":1}`);
    f.store.setGuildFeatureSetting("g1", "omikuji", `{"enabled":true}`);
    const settings = f.store.getGuildFeatureSettings("g1");
    assert.equal(settings.get("points"), `{"rate":1}`);
    assert.equal(f.store.listGuildFeatureSettings("g1").length, 2);
    f.store.deleteGuildFeatureSetting("g1", "omikuji");
    assert.equal(f.store.getGuildFeatureSettings("g1").has("omikuji"), false);
    assert.throws(() => f.store.setGuildFeatureSetting("g1", "bad", "not-json"));

    assert.equal(f.store.isGuildBlacklisted("g1", "u9"), false);
    f.store.addGuildBlacklist("g1", "u9", "spam");
    assert.equal(f.store.isGuildBlacklisted("g1", "u9"), true);
    assert.equal(f.store.listGuildBlacklist("g1")[0]?.reason, "spam");
    f.store.removeGuildBlacklist("g1", "u9");
    assert.equal(f.store.isGuildBlacklisted("g1", "u9"), false);
  } finally {
    f.cleanup();
  }
});

test("sticky_messages の保存・ID 差し替え・削除", () => {
  const f = openFixture();
  try {
    f.store.setStickyMessage({ guildId: "g1", channelId: "c1", messageId: "m1", content: "固定文" });
    assert.equal(f.store.getStickyMessage("g1", "c1")?.content, "固定文");
    f.store.updateStickyMessageId("g1", "c1", "m1", "m2");
    assert.equal(f.store.getStickyMessage("g1", "c1")?.messageId, "m2");
    // 📌 元 ID が合わない差し替えは例外（設定が先に変わったケース）
    assert.throws(() => f.store.updateStickyMessageId("g1", "c1", "m1", "m3"));
    assert.equal(f.store.listStickyMessages("g1").length, 1);
    f.store.removeStickyMessage("g1", "c1");
    assert.equal(f.store.getStickyMessage("g1", "c1"), null);
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------
// 🎮 ポイント・抽選・おみくじ
// ------------------------------------------

test("earnPoints はクールダウン・日次上限・冪等性を守る", () => {
  const f = openFixture();
  try {
    const base = { guildId: "g1", userId: "u1", points: 5, cooldownSeconds: 60, dailyLimit: 7 };
    // ✅ 1回目: 5pt 付与
    assert.deepEqual(f.store.earnPoints({ ...base, eventId: "e1" }), { balance: 5, earned: 5 });
    // 🔁 同じ event の再実行: 台帳の event_key で二重付与を防ぐ
    assert.deepEqual(f.store.earnPoints({ ...base, eventId: "e1" }), { balance: 5, earned: 0 });
    // 🕐 クールダウン中（別 event）: 付与なし
    assert.deepEqual(f.store.earnPoints({ ...base, eventId: "e2" }), { balance: 5, earned: 0 });
    // 🕐 61秒後: 日次上限 7 までの残り 2pt だけ付与
    f.advanceMs(61_000);
    assert.deepEqual(f.store.earnPoints({ ...base, eventId: "e3" }), { balance: 7, earned: 2 });
    // 🚫 上限到達後は付与なし
    f.advanceMs(61_000);
    assert.deepEqual(f.store.earnPoints({ ...base, eventId: "e4" }), { balance: 7, earned: 0 });
    // 📅 翌日（UTC）: 日次カウンタがリセットされる
    f.advanceMs(24 * 3_600_000);
    assert.deepEqual(f.store.earnPoints({ ...base, eventId: "e5" }), { balance: 12, earned: 5 });

    assert.equal(f.store.getPointBalance("g1", "u1"), 12);
    assert.equal(f.store.getPointAccountRow("g1", "u1")?.earned_today, 5);
    assert.equal(f.store.listPointAccounts("g1").length, 1);
    assert.equal(f.store.getPointLedgerByEventKey("earn:e1")?.delta, 5);
    assert.equal(f.store.listPointLedger("g1", "u1").length, 3);
  } finally {
    f.cleanup();
  }
});

test("drawLottery は結果を保存し、再実行で同じ結果を返す", () => {
  const f = openFixture();
  try {
    f.store.earnPoints({
      guildId: "g1", userId: "u1", eventId: "seed", points: 100, cooldownSeconds: 0, dailyLimit: 1000,
    });
    f.setRandomInt(0); // 🎲 0 < chance なら当選
    const first = f.store.drawLottery({
      guildId: "g1", userId: "u1", eventId: "lot-1", cost: 10, prize: 50, chance: 20,
    });
    assert.equal(first.won, true);
    assert.equal(first.points.balance, 140);
    // 🔁 再実行: 保存済み結果を返し、二重に課金しない
    const replay = f.store.drawLottery({
      guildId: "g1", userId: "u1", eventId: "lot-1", cost: 10, prize: 50, chance: 20,
    });
    assert.deepEqual(replay, first);
    assert.equal(f.store.getPointBalance("g1", "u1"), 140);
    // 🚫 残高不足は例外
    assert.throws(
      () => f.store.drawLottery({ guildId: "g1", userId: "u2", eventId: "lot-2", cost: 10, prize: 50, chance: 20 }),
      /insufficient points/,
    );
  } finally {
    f.cleanup();
  }
});

test("drawOmikuji は1日1回で、再実行は保存済み結果を返す", () => {
  const f = openFixture();
  try {
    f.setRandomInt(0); // 🎲 先頭 = 大吉
    assert.equal(f.store.drawOmikuji({ guildId: "g1", userId: "u1", eventId: "omi-1" }), "大吉");
    // 🔁 同じ event: 保存済み結果
    assert.equal(f.store.drawOmikuji({ guildId: "g1", userId: "u1", eventId: "omi-1" }), "大吉");
    // 🚫 別 event でも同日は引けない
    assert.throws(
      () => f.store.drawOmikuji({ guildId: "g1", userId: "u1", eventId: "omi-2" }),
      /already drawn today/,
    );
    assert.equal(f.store.getOmikujiDraw("g1", "u1", "2026-11-28")?.result, "大吉");
    assert.equal(f.store.listOmikujiDraws("g1", "u1").length, 1);
    // ⭐ star_feature_actions にも直接触れる
    f.store.putStarFeatureAction("manual:1", `{"ok":true}`);
    assert.equal(f.store.getStarFeatureAction("manual:1")?.result_json, `{"ok":true}`);
    assert.equal(f.store.getStarFeatureAction("missing"), null);
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------
// 🛍️ ショップ
// ------------------------------------------

test("ショップの購入から付与完了までの流れ", () => {
  const f = openFixture();
  try {
    f.store.upsertShopItem("g1", { itemId: "role-red", name: "赤ロール", price: 30, roleId: "r1" });
    f.store.upsertShopItem("g1", { itemId: "role-blue", name: "青ロール", price: 10, roleId: "r2" });
    f.store.setShopItemEnabled("g1", "role-blue", false);
    // 📋 一覧は有効なものだけ
    assert.deepEqual(f.store.listShopItems("g1").map((item) => item.itemId), ["role-red"]);
    assert.equal(f.store.getShopItem("g1", "role-blue")?.enabled, 0);

    // 💰 残高を用意して購入
    f.store.earnPoints({
      guildId: "g1", userId: "u1", eventId: "seed", points: 100, cooldownSeconds: 0, dailyLimit: 1000,
    });
    const bought = f.store.buyShopItem({ guildId: "g1", userId: "u1", itemId: "role-red", eventId: "buy-1" });
    assert.equal(bought.rolePending, true);
    assert.equal(bought.points.balance, 70);
    const inventory = f.store.getInventoryItem("g1", "u1", "role-red");
    assert.equal(inventory?.role_status, "pending");
    assert.equal(inventory?.role_id, "r1");
    assert.equal(f.store.listPendingRoleGrants("g1").length, 1);

    // 🔁 同じ event の再実行は保存済み結果（二重課金なし）
    const replay = f.store.buyShopItem({ guildId: "g1", userId: "u1", itemId: "role-red", eventId: "buy-1" });
    assert.deepEqual(replay, bought);
    // 🔁 pending の再試行（別 event）も追加課金なし
    const retry = f.store.buyShopItem({ guildId: "g1", userId: "u1", itemId: "role-red", eventId: "buy-2" });
    assert.equal(retry.rolePending, true);
    assert.equal(f.store.getPointBalance("g1", "u1"), 70);

    // ✅ 付与完了（冪等: 2回目も成功扱い）
    f.store.completeShopRoleGrant("g1", "u1", "role-red");
    f.store.completeShopRoleGrant("g1", "u1", "role-red");
    assert.equal(f.store.getInventoryItem("g1", "u1", "role-red")?.role_status, "fulfilled");
    assert.equal(f.store.listInventory("g1", "u1").length, 1);
    assert.equal(f.store.listPendingRoleGrants("g1").length, 0);
    // 🚫 購入済みは買えない / 残高不足は例外
    assert.throws(
      () => f.store.buyShopItem({ guildId: "g1", userId: "u1", itemId: "role-red", eventId: "buy-3" }),
      /already owned/,
    );
    assert.throws(
      () => f.store.buyShopItem({ guildId: "g1", userId: "u2", itemId: "role-red", eventId: "buy-4" }),
      /insufficient points/,
    );
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------
// 🔊 読み上げ設定・辞書・監査ログ
// ------------------------------------------

test("read_aloud_settings の既定値・保存・検証と監査ログ", () => {
  const f = openFixture();
  try {
    // 📖 未保存なら既定値＋ revision 0
    const initial = f.store.getReadAloudSettings("global", "global");
    assert.equal(initial.revision, 0);
    assert.equal(JSON.parse(initial.settingsJson).speaker_id, 1);
    // 💾 保存で revision が進み、監査ログが残る
    const revision = f.store.putReadAloudSettings(
      "user", "u1", `{"enabled":true,"speed":1.5,"volume":1.0,"speaker_id":3}`, "tester",
    );
    assert.equal(revision, 1);
    assert.equal(f.store.getReadAloudSettingsRow("user", "u1")?.revision, 1);
    const logs = f.store.listAuditLogs();
    assert.equal(logs[0]?.action, "read_aloud_settings.update");
    assert.equal(logs[0]?.target, "user:u1");
    // 🚫 範囲外の speed と不正なスコープは例外
    assert.throws(() =>
      f.store.putReadAloudSettings("user", "u1", `{"enabled":true,"speed":3.0,"volume":1.0,"speaker_id":3}`, "tester"),
    );
    assert.throws(() => f.store.getReadAloudSettings("guild", ""));
  } finally {
    f.cleanup();
  }
});

test("辞書エントリの追加・更新・削除と辞書ヘッダー", () => {
  const f = openFixture();
  try {
    f.store.putDictionaryEntry({ scope: "global", scopeId: "global", word: "夜凪", reading: "よなぎ", actor: "tester" });
    f.store.putDictionaryEntry({ scope: "global", scopeId: "global", word: "星燈", reading: "せいとう", actor: "tester" });
    const entries = f.store.listDictionaryEntries("global", "global");
    assert.equal(entries.length, 2);
    // 📖 単語の更新は reading だけ差し替わる
    f.store.putDictionaryEntry({ scope: "global", scopeId: "global", word: "夜凪", reading: "よるなぎ", actor: "tester" });
    assert.equal(
      f.store.listDictionaryEntries("global", "global").find((e) => e.word === "夜凪")?.reading,
      "よるなぎ",
    );
    assert.equal(f.store.listDictionaryEntryRows("global", "global").length, 2);
    const dictionary = f.store.getDictionary("global", "global");
    assert.ok(dictionary !== null && dictionary.revision >= 3);
    assert.equal(f.store.listDictionaries().length, 1);
    // 📝 監査ログにも残る
    assert.ok(f.store.listAuditLogs().some((log) => log.action === "dictionary.upsert"));
    f.store.deleteDictionaryEntry("global", "global", "星燈");
    assert.equal(f.store.listDictionaryEntries("global", "global").length, 1);
    // 📝 appendAuditLog の直接利用
    const id = f.store.appendAuditLog({ actor: "tester", action: "manual", target: "x", detailsJson: "{}" });
    assert.ok(id > 0);
  } finally {
    f.cleanup();
  }
});

// ------------------------------------------
// 📨 配送基盤
// ------------------------------------------

test("gateway_sessions と event_inbox の受付（recordDispatch）", () => {
  const f = openFixture();
  try {
    // 🔌 セッションが無い Bot は lastSequence = -1
    assert.equal(f.store.loadSession("general").lastSequence, -1);
    const session = {
      botId: "general", sessionId: "s1", resumeGatewayUrl: "wss://example", lastSequence: 42, botUserId: "bot-1",
    };
    const event = {
      eventId: "ev-1", correlationId: "c1", botId: "general", sessionId: "s1", sequence: 42,
      eventType: "MESSAGE_CREATE", orderingKey: "g1:c1", occurredAt: "2026-11-28T12:00:00.000000000Z",
      botUserId: "bot-1", payloadJson: `{"x":1}`,
    };
    f.store.recordDispatch(session, event);
    assert.equal(f.store.loadSession("general").lastSequence, 42);
    assert.equal(f.store.getGatewaySessionRow("general")?.session_id, "s1");
    assert.equal(f.store.getEventInboxRow("ev-1")?.status, "pending");
    // 🔁 同じイベントの再記録は無視される
    f.store.recordDispatch(session, event);
    assert.equal(f.store.listEventInbox("general").length, 1);
    // 🔌 セッション消去
    f.store.clearSession("general");
    assert.equal(f.store.loadSession("general").lastSequence, -1);
  } finally {
    f.cleanup();
  }
});

test("event_inbox の claim / ack / nack とデッドレター", () => {
  const f = openFixture();
  try {
    const session = {
      botId: "general", sessionId: "s1", resumeGatewayUrl: "", lastSequence: 1, botUserId: "bot-1",
    };
    const makeEvent = (eventId: string) => ({
      eventId, correlationId: "c1", botId: "general", sessionId: "s1", sequence: 1,
      eventType: "MESSAGE_CREATE", orderingKey: `key-${eventId}`,
      occurredAt: "2026-11-28T12:00:00.000000000Z", botUserId: "bot-1", payloadJson: "{}",
    });
    f.store.recordDispatch(session, makeEvent("ev-1"));
    f.store.recordDispatch(session, makeEvent("ev-2"));

    // 📨 claim → ack
    const claimed = f.store.claimEvent({ botId: "general", instanceId: "w1", leaseSeconds: 30, maxAttempts: 3 });
    assert.ok(claimed !== null);
    assert.equal(claimed.attempts, 1);
    assert.equal(f.store.getEventInboxRow(claimed.event.event_id)?.status, "processing");
    assert.throws(() => f.store.ackEvent("general", claimed.event.event_id, "wrong-token"));
    f.store.ackEvent("general", claimed.event.event_id, claimed.leaseToken);
    assert.equal(f.store.getEventInboxRow(claimed.event.event_id)?.status, "acked");

    // 📨 claim → nack（上限未満は pending に戻り、バックオフ後に再 claim）
    const second = f.store.claimEvent({ botId: "general", instanceId: "w1", leaseSeconds: 30, maxAttempts: 2 });
    assert.ok(second !== null);
    f.store.nackEvent({
      botId: "general", eventId: second.event.event_id, token: second.leaseToken,
      reason: "boom", maxAttempts: 2,
    });
    assert.equal(f.store.getEventInboxRow(second.event.event_id)?.status, "pending");
    // 🕐 バックオフ（2^1 秒）経過後に再 claim し、再度 nack すると上限で dead
    f.advanceMs(3_000);
    const third = f.store.claimEvent({ botId: "general", instanceId: "w1", leaseSeconds: 30, maxAttempts: 2 });
    assert.ok(third !== null);
    assert.equal(third.attempts, 2);
    f.store.nackEvent({
      botId: "general", eventId: third.event.event_id, token: third.leaseToken,
      reason: "boom again", maxAttempts: 2,
    });
    assert.equal(f.store.getEventInboxRow(third.event.event_id)?.status, "dead");
    assert.equal(f.store.getEventDeadLetter(third.event.event_id)?.reason, "boom again");
    assert.equal(f.store.listEventDeadLetters("general").length, 1);
    // 🗑️ デッドレターの直接記録
    f.store.insertEventDeadLetter({
      event_id: "manual-1", bot_id: "general", event_type: "X", reason: "manual", attempts: 1, payload_json: "{}",
    });
    assert.equal(f.store.listEventDeadLetters().length, 2);
  } finally {
    f.cleanup();
  }
});

test("worker_instances の登録・ハートビートと discord_operations の冪等性", () => {
  const f = openFixture();
  try {
    // 🔗 worker_instances / discord_operations は bots への外部キーを
    // 持つため、先に Bot を登録する（本番でも Gateway が先に登録する）
    f.store.upsertBot({ botId: "general", displayName: "星燈" });
    f.store.registerWorker("inst-1", { workerId: "w-general", role: "worker", botId: "general" });
    assert.equal(f.store.isWorkerRegistered("inst-1", "w-general", "general"), true);
    // 🚫 同じ instance_id を別の worker では登録できない
    assert.throws(() =>
      f.store.registerWorker("inst-1", { workerId: "w-other", role: "worker", botId: "general" }),
    );
    f.store.heartbeat("inst-1", "w-general", "general");
    assert.throws(() => f.store.heartbeat("inst-x", "w-general", "general"));
    assert.equal(f.store.latestWorkerHeartbeats().get("general"), "2026-11-28T12:00:00.000000000Z");
    assert.equal(f.store.getWorkerInstance("inst-1")?.status, "online");
    assert.equal(f.store.listWorkerInstances().length, 1);

    // 🔒 操作は1回だけ確保できる
    assert.equal(f.store.createOperation("op-1", "general", "send_message"), true);
    assert.equal(f.store.createOperation("op-1", "general", "send_message"), false);
    f.store.updateOperation({
      id: "op-1", botId: "general", operation: "send_message",
      status: "succeeded", responseRef: "msg-1", errorMessage: "",
    });
    assert.deepEqual(f.store.getOperationResult("op-1", "general", "send_message"), {
      status: "succeeded", responseRef: "msg-1",
    });
    assert.equal(f.store.getOperation("op-1")?.status, "succeeded");
    assert.equal(f.store.getOperationResult("missing", "general", "send_message"), null);
  } finally {
    f.cleanup();
  }
});

test("event_idempotency_keys と保持期限の掃除（pruneExpiredEvents）", () => {
  const f = openFixture();
  try {
    // 🔑 期限内キーは存在し、期限切れは掃除される
    f.store.putEventIdempotencyKey("handler", "key-1", "2026-11-29T12:00:00.000000000Z");
    f.store.putEventIdempotencyKey("handler", "key-old", "2026-11-27T12:00:00.000000000Z");
    assert.equal(f.store.hasEventIdempotencyKey("handler", "key-1"), true);
    assert.equal(f.store.hasEventIdempotencyKey("handler", "key-old"), false);
    assert.equal(f.store.listEventIdempotencyKeys().length, 2);
    assert.equal(f.store.deleteExpiredEventIdempotencyKeys(), 1);

    // 🗑️ 25時間前のイベントは、24時間保持の掃除でデッドレター化される
    const session = {
      botId: "general", sessionId: "s1", resumeGatewayUrl: "", lastSequence: 1, botUserId: "bot-1",
    };
    f.store.recordDispatch(session, {
      eventId: "ev-old", correlationId: "c1", botId: "general", sessionId: "s1", sequence: 1,
      eventType: "MESSAGE_CREATE", orderingKey: "k1",
      occurredAt: "2026-11-28T12:00:00.000000000Z", botUserId: "bot-1", payloadJson: `{"secret":1}`,
    });
    f.advanceMs(25 * 3_600_000);
    assert.equal(f.store.pruneExpiredEvents(24), 1);
    assert.equal(f.store.getEventInboxRow("ev-old"), null);
    // 📝 デッドレターには残るが、本文は保持期限で消去される
    assert.equal(f.store.getEventDeadLetter("ev-old")?.payload_json, "{}");
    assert.throws(() => f.store.pruneExpiredEvents(0));
  } finally {
    f.cleanup();
  }
});

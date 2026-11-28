// ==========================================
// 🧪 星燈グループ (b) ポイント系のテスト
// ==========================================
// 🧪 ゲーム設定の解決・結果文と、DB 層取引を使ったポイントの
// 流れ（報酬→残高→抽選→購入）を固定時計で確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase, type Store } from "../src/db/index.js";
import { StarSettings } from "../src/seitou/settings.js";
import { formatGameConfigSummary, gameConfigOf, resolveGameConfig, GAME_DEFAULTS } from "../src/seitou/game.js";

// ------------------------------------------
// 🎮 ゲーム設定
// ------------------------------------------

test("resolveGameConfig: 未保存なら初期値、保存分だけ上書きする", () => {
  assert.deepEqual(resolveGameConfig(null), GAME_DEFAULTS);
  assert.deepEqual(resolveGameConfig(undefined), GAME_DEFAULTS);
  const merged = resolveGameConfig({ lottery_cost: 30, lottery_chance: 5, points_per_message: "x" });
  assert.equal(merged.lottery_cost, 30);
  assert.equal(merged.lottery_chance, 5);
  // 📌 数値でない値は初期値のまま。
  assert.equal(merged.points_per_message, GAME_DEFAULTS.points_per_message);
  assert.equal(merged.daily_limit, GAME_DEFAULTS.daily_limit);
});

test("formatGameConfigSummary: 旧実装の文面どおり", () => {
  assert.equal(
    formatGameConfigSummary({ ...GAME_DEFAULTS }),
    "ゲーム設定を更新しました。メッセージ獲得 1pt / クールダウン 60秒 / 日上限 50pt / 抽選 10pt、当選確率 20%、追加報酬 50pt",
  );
});

test("gameConfigOf: StarSettings 経由の往復", () => {
  const store = openDatabase({ path: ":memory:" });
  try {
    const settings = new StarSettings(store);
    assert.deepEqual(gameConfigOf(settings.getAll("g1")), GAME_DEFAULTS);
    settings.set("g1", "game", { ...GAME_DEFAULTS, daily_limit: 10 });
    assert.equal(gameConfigOf(settings.getAll("g1")).daily_limit, 10);
  } finally {
    store.close();
  }
});

// ------------------------------------------
// 🎮 ポイントの流れ（固定時計）
// ------------------------------------------

function openStore(randomValue: { value: number }): { store: Store; advanceMs: (ms: number) => void } {
  let current = new Date("2026-11-28T12:00:00.000Z");
  let idCounter = 0;
  const store = openDatabase({
    path: ":memory:",
    hooks: {
      clock: () => current,
      randomId: (prefix: string) => `${prefix}fixed-${++idCounter}`,
      randomInt: () => randomValue.value,
    },
  });
  return {
    store,
    advanceMs: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

test("報酬→残高→抽選（当選）→おみくじは1日1回", () => {
  const random = { value: 0 };
  const { store, advanceMs } = openStore(random);
  try {
    const game = { ...GAME_DEFAULTS };
    // 📝 メッセージ報酬: 1件目は付与、同一イベントの再送は冪等。
    const earned = store.earnPoints({
      guildId: "g1",
      userId: "u1",
      eventId: "m1",
      points: game.points_per_message,
      cooldownSeconds: game.cooldown_seconds,
      dailyLimit: game.daily_limit,
    });
    assert.deepEqual(earned, { balance: 1, earned: 1 });
    const again = store.earnPoints({
      guildId: "g1",
      userId: "u1",
      eventId: "m1",
      points: 1,
      cooldownSeconds: 60,
      dailyLimit: 50,
    });
    assert.equal(again.earned, 0);
    // 📝 クールダウン中は付与されない。
    const cooled = store.earnPoints({
      guildId: "g1",
      userId: "u1",
      eventId: "m2",
      points: 1,
      cooldownSeconds: 60,
      dailyLimit: 50,
    });
    assert.equal(cooled.earned, 0);
    advanceMs(61_000);
    // 📝 残高を貯める（日次上限まで一気に付与される形で確認）。
    for (let i = 0; i < 20; i++) {
      store.earnPoints({
        guildId: "g1",
        userId: "u1",
        eventId: `bulk-${i}`,
        points: 1,
        cooldownSeconds: 0,
        dailyLimit: 50,
      });
    }
    assert.equal(store.getPointBalance("g1", "u1"), 21);

    // 🎲 抽選: randomInt=0 < chance 20 で当選。-10 +50。
    const lottery = store.drawLottery({
      guildId: "g1",
      userId: "u1",
      eventId: "l1",
      cost: game.lottery_cost,
      prize: game.lottery_prize,
      chance: game.lottery_chance,
    });
    assert.equal(lottery.won, true);
    assert.equal(lottery.points.balance, 61);

    // 🎴 おみくじ: 1日1回。2回目は例外。
    const fortune = store.drawOmikuji({ guildId: "g1", userId: "u1", eventId: "o1" });
    assert.equal(typeof fortune, "string");
    assert.throws(
      () => store.drawOmikuji({ guildId: "g1", userId: "u1", eventId: "o2" }),
      /omikuji already drawn today/,
    );
  } finally {
    store.close();
  }
});

test("購入: 残高不足は例外、購入後は pending → 完了で確定する", () => {
  const random = { value: 0 };
  const { store } = openStore(random);
  try {
    store.upsertShopItem("g1", { itemId: "role-a", name: "特別ロール", price: 30, roleId: "r1" });
    // 📝 口座が無いユーザーは残高0として「ポイント不足」になる。
    assert.throws(
      () => store.buyShopItem({ guildId: "g1", userId: "u9", itemId: "role-a", eventId: "b0" }),
      /insufficient points/,
    );
    store.earnPoints({
      guildId: "g1",
      userId: "u1",
      eventId: "seed",
      points: 50,
      cooldownSeconds: 0,
      dailyLimit: 50,
    });
    const bought = store.buyShopItem({ guildId: "g1", userId: "u1", itemId: "role-a", eventId: "b1" });
    assert.equal(bought.rolePending, true);
    assert.equal(bought.points.balance, 20);
    // 🔁 pending の再実行は再課金なしで再試行を返す。
    const retry = store.buyShopItem({ guildId: "g1", userId: "u1", itemId: "role-a", eventId: "b2" });
    assert.equal(retry.rolePending, true);
    assert.equal(retry.points.balance, 20);
    store.completeShopRoleGrant("g1", "u1", "role-a");
    assert.throws(
      () => store.buyShopItem({ guildId: "g1", userId: "u1", itemId: "role-a", eventId: "b3" }),
      /shop item already owned/,
    );
    // 🛍️ 一覧には有効な商品だけが出る。
    assert.deepEqual(
      store.listShopItems("g1").map((item) => item.itemId),
      ["role-a"],
    );
  } finally {
    store.close();
  }
});

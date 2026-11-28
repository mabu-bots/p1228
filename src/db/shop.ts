// ==========================================
// 🛍️ ショップと所持品のアクセサ
// ==========================================
// 🛍️ shop_items / user_inventory の読み書き。旧実装（Go の
// star_features.go）の購入取引を意味そのままに移したもの。
// 購入は「pending で記録 → ロール付与後に fulfilled」の2段階で、
// 003 / 004 の列（role_status / role_id）を前提にする。

import type { DbContext } from "./context.js";
import { getStarFeatureAction, putStarFeatureAction, type PointResult } from "./points.js";
import type { ShopItemRow, UserInventoryRow } from "./rows.js";

export interface ShopItem {
  itemId: string;
  name: string;
  price: number;
  roleId: string;
}

// ------------------------------------------
// 🛍️ 商品カタログ
// ------------------------------------------

// 🛍️ 商品を登録・更新する（旧 UpsertShopItem 相当。再登録で有効化する）。
export function upsertShopItem(ctx: DbContext, guildId: string, item: ShopItem): void {
  if (
    guildId === "" ||
    item.itemId === "" ||
    item.itemId.length > 50 ||
    item.name.trim() === "" ||
    [...item.name].length > 100 ||
    item.price < 1 ||
    item.roleId === ""
  ) {
    throw new Error("shop item requires item_id, name, positive price and role_id");
  }
  if (!/^[A-Za-z0-9-]+$/.test(item.itemId)) {
    throw new Error("shop item_id may contain only ASCII letters, numbers and hyphens");
  }
  ctx.db
    .prepare(
      `INSERT INTO shop_items(guild_id, item_id, name, price, role_id, enabled, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(guild_id, item_id) DO UPDATE SET name = excluded.name, price = excluded.price,
         role_id = excluded.role_id, enabled = 1`,
    )
    .run(guildId, item.itemId, item.name, item.price, item.roleId, ctx.now());
}

// 🛍️ 商品を1件取得する（無効化されたものも含む。無ければ null）。
export function getShopItem(ctx: DbContext, guildId: string, itemId: string): ShopItemRow | null {
  return (
    (ctx.db
      .prepare("SELECT * FROM shop_items WHERE guild_id = ? AND item_id = ?")
      .get(guildId, itemId) as ShopItemRow | undefined) ?? null
  );
}

// 🛍️ 有効な商品を item_id 順に返す（旧 ListShopItems 相当）。
export function listShopItems(ctx: DbContext, guildId: string): ShopItem[] {
  const rows = ctx.db
    .prepare(
      "SELECT item_id, name, price, role_id FROM shop_items WHERE guild_id = ? AND enabled = 1 ORDER BY item_id",
    )
    .all(guildId) as Pick<ShopItemRow, "item_id" | "name" | "price" | "role_id">[];
  return rows.map((row) => ({
    itemId: row.item_id,
    name: row.name,
    price: row.price,
    roleId: row.role_id,
  }));
}

// 🛍️ 商品の有効/無効を切り替える。
export function setShopItemEnabled(
  ctx: DbContext,
  guildId: string,
  itemId: string,
  enabled: boolean,
): void {
  ctx.db
    .prepare("UPDATE shop_items SET enabled = ? WHERE guild_id = ? AND item_id = ?")
    .run(enabled ? 1 : 0, guildId, itemId);
}

// ------------------------------------------
// 🎒 所持品
// ------------------------------------------

// 🎒 所持品を1件取得する（無ければ null）。
export function getInventoryItem(
  ctx: DbContext,
  guildId: string,
  userId: string,
  itemId: string,
): UserInventoryRow | null {
  return (
    (ctx.db
      .prepare(
        "SELECT * FROM user_inventory WHERE guild_id = ? AND user_id = ? AND item_id = ?",
      )
      .get(guildId, userId, itemId) as UserInventoryRow | undefined) ?? null
  );
}

// 🎒 ユーザーの所持品全件を返す。
export function listInventory(ctx: DbContext, guildId: string, userId: string): UserInventoryRow[] {
  return ctx.db
    .prepare("SELECT * FROM user_inventory WHERE guild_id = ? AND user_id = ? ORDER BY item_id")
    .all(guildId, userId) as UserInventoryRow[];
}

// 🎒 ロール付与が未完了（pending）の所持品を返す（再試行用）。
export function listPendingRoleGrants(ctx: DbContext, guildId: string): UserInventoryRow[] {
  return ctx.db
    .prepare(
      "SELECT * FROM user_inventory WHERE guild_id = ? AND role_status = 'pending' ORDER BY purchased_at",
    )
    .all(guildId) as UserInventoryRow[];
}

// ------------------------------------------
// 🛍️ 購入（旧 BuyShopItem 相当）
// ------------------------------------------

export interface BuyResult {
  item: ShopItem;
  points: PointResult;
  // 🎭 ロール付与が未完了なら true。完了は completeShopRoleGrant で記録する
  rolePending: boolean;
}

// 🛍️ 商品を購入する。同じ event の再実行は保存済み結果を返す。
// pending の所持品がある場合は追加課金なしで再試行を返す。
export function buyShopItem(
  ctx: DbContext,
  args: { guildId: string; userId: string; itemId: string; eventId: string },
): BuyResult {
  const { guildId, userId, itemId, eventId } = args;
  if (guildId === "" || userId === "" || itemId === "" || eventId === "") {
    throw new Error("guild_id, user_id, item_id and event_id are required");
  }
  const run = ctx.db.transaction((): BuyResult => {
    const saved = getStarFeatureAction(ctx, `shop:${eventId}`);
    if (saved !== null) {
      // 📝 保存形式は旧実装の JSON フィールド名のまま（item_id 等）。
      // 旧実装が書いた結果をそのまま読み戻せるようにするため。
      const parsed = JSON.parse(saved.result_json) as {
        item: { item_id: string; name: string; price: number; role_id: string };
        points: PointResult;
        role_pending: boolean;
      };
      return {
        item: {
          itemId: parsed.item.item_id,
          name: parsed.item.name,
          price: parsed.item.price,
          roleId: parsed.item.role_id,
        },
        points: parsed.points,
        rolePending: parsed.role_pending,
      };
    }
    const row = getShopItem(ctx, guildId, itemId);
    if (row === null) throw new Error("shop item not found");
    const item: ShopItem = { itemId: row.item_id, name: row.name, price: row.price, roleId: row.role_id };

    // ⭐ ポイントを稼いだことがないユーザーには口座行がまだ無い。
    // 残高0として扱い、下の価格検査が「ポイント不足」を返すようにする。
    const balance = ctx.db
      .prepare("SELECT balance FROM point_accounts WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId) as { balance: number } | undefined;

    const owned = getInventoryItem(ctx, guildId, userId, itemId);
    if (owned !== null) {
      if (owned.role_status !== "pending") throw new Error("shop item already owned");
      // 🎭 カタログが後から編集・無効化されても、購入時のロールを維持する。
      if (owned.role_id !== "") item.roleId = owned.role_id;
      return { item, points: { balance: balance?.balance ?? 0, earned: 0 }, rolePending: true };
    }
    if (row.enabled !== 1) throw new Error("shop item is disabled");
    const currentBalance = balance?.balance ?? 0;
    if (currentBalance < item.price) throw new Error("insufficient points");

    ctx.db
      .prepare(
        `INSERT INTO user_inventory(guild_id, user_id, item_id, purchased_at, role_status, role_id)
         VALUES(?, ?, ?, ?, 'pending', ?)`,
      )
      .run(guildId, userId, itemId, ctx.now(), item.roleId);
    ctx.db
      .prepare(
        `INSERT INTO point_ledger(transaction_id, event_key, guild_id, user_id, delta, reason, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ctx.randomId("pt_"),
        `shop:${eventId}`,
        guildId,
        userId,
        -item.price,
        `shop purchase: ${itemId}`,
        ctx.now(),
      );
    ctx.db
      .prepare("UPDATE point_accounts SET balance = balance - ? WHERE guild_id = ? AND user_id = ?")
      .run(item.price, guildId, userId);
    const points: PointResult = { balance: currentBalance - item.price, earned: 0 };
    putStarFeatureAction(
      ctx,
      `shop:${eventId}`,
      JSON.stringify({
        item: { item_id: item.itemId, name: item.name, price: item.price, role_id: item.roleId },
        points,
        role_pending: true,
      }),
    );
    return { item, points, rolePending: true };
  });
  return run();
}

// 🔁 ロール付与の完了を記録する（旧 CompleteShopRoleGrant 相当、冪等）。
export function completeShopRoleGrant(
  ctx: DbContext,
  guildId: string,
  userId: string,
  itemId: string,
): void {
  if (guildId === "" || userId === "" || itemId === "") {
    throw new Error("guild_id, user_id and item_id are required");
  }
  const result = ctx.db
    .prepare(
      `UPDATE user_inventory SET role_status = 'fulfilled'
       WHERE guild_id = ? AND user_id = ? AND item_id = ? AND role_status = 'pending'`,
    )
    .run(guildId, userId, itemId);
  if (result.changes === 1) return;
  const owned = getInventoryItem(ctx, guildId, userId, itemId);
  if (owned === null) throw new Error("shop inventory not found");
  if (owned.role_status !== "fulfilled") {
    throw new Error("shop inventory is not pending role fulfillment");
  }
}

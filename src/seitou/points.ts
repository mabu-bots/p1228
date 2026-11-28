// ==========================================
// 🎮 星燈のポイント系コマンド（グループ b）
// ==========================================
// 🎮 game-config / omikuji / points / lottery / shop / buy。
// 取引そのものは Phase 1 の DB 層（Store）が担い、ここは
// インタラクションとの受け渡しと文言だけを持つ。文言は旧実装
// （star-command-handler.ts）どおり。

import type { ChatInputCommandInteraction } from "discord.js";
import { logger } from "../logger.js";
import type { SeitouDeps } from "./deps.js";
import { GAME_CONFIG_KEYS, formatGameConfigSummary, gameConfigOf, type GameConfig } from "./game.js";
import { errorMessage, expectedGameErrorMessage } from "./shared.js";
import { replyEphemeral } from "./reply.js";
import { addGuildRole } from "./discord-ops.js";

// ------------------------------------------
// 🎮 振り分け
// ------------------------------------------

// 🎮 グループ (b) のコマンドなら処理して true を返す。
export async function handlePointsCommand(
  deps: SeitouDeps,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const name = interaction.commandName;
  if (!["game-config", "omikuji", "points", "lottery", "shop", "buy"].includes(name)) return false;
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const eventId = interaction.id;
  let message: string;

  if (name === "game-config") {
    // ------------------------------------------
    // 🎮 ゲーム設定
    // ------------------------------------------
    const current: GameConfig = gameConfigOf(deps.settings.getAll(guildId));
    for (const key of GAME_CONFIG_KEYS) {
      const value = interaction.options.getInteger(key);
      if (value !== null) current[key] = value;
    }
    deps.settings.set(guildId, "game", current);
    message = formatGameConfigSummary(current);
  } else if (name === "omikuji") {
    // ------------------------------------------
    // 🎴 おみくじ
    // ------------------------------------------
    try {
      const fortune = deps.store.drawOmikuji({ guildId, userId, eventId });
      message = `今日のおみくじは **${fortune}** です。`;
    } catch (error) {
      if (!await replyKnownGameError(interaction, error)) throw error;
      return true;
    }
  } else if (name === "points") {
    const balance = deps.store.getPointBalance(guildId, userId);
    message = `所持ポイント: **${balance} pt**`;
  } else if (name === "lottery") {
    // ------------------------------------------
    // 🎲 抽選
    // ------------------------------------------
    const game = gameConfigOf(deps.settings.getAll(guildId));
    try {
      const result = deps.store.drawLottery({
        guildId,
        userId,
        eventId,
        cost: game.lottery_cost,
        prize: game.lottery_prize,
        chance: game.lottery_chance,
      });
      message = `${result.won ? `当選！追加で ${game.lottery_prize} pt 獲得しました。` : "今回ははずれです。"} 残高: **${result.points.balance} pt**`;
    } catch (error) {
      if (!await replyKnownGameError(interaction, error)) throw error;
      return true;
    }
  } else if (name === "shop" && interaction.options.getSubcommand() === "add") {
    // ------------------------------------------
    // 🛍️ ショップ: 商品登録
    // ------------------------------------------
    const item = {
      itemId: interaction.options.getString("item_id", true),
      name: interaction.options.getString("name", true),
      price: interaction.options.getInteger("price", true),
      roleId: interaction.options.getRole("role", true).id,
    };
    deps.store.upsertShopItem(guildId, item);
    message = `商品「${item.name}」を登録しました。`;
  } else if (name === "shop") {
    // ------------------------------------------
    // 🛍️ ショップ: 一覧
    // ------------------------------------------
    const items = deps.store.listShopItems(guildId);
    const shown = items.slice(0, 10);
    message = shown.length
      ? shown.map((item) => `\`${item.itemId}\` — ${item.name}: ${item.price} pt`).join("\n")
      : "販売中の商品はありません。";
    if (items.length > shown.length) message += `\nほか ${items.length - shown.length} 件`;
  } else {
    // ------------------------------------------
    // 🛍️ 購入
    // ------------------------------------------
    const itemId = interaction.options.getString("item_id", true);
    let purchase;
    try {
      purchase = deps.store.buyShopItem({ guildId, userId, itemId, eventId });
    } catch (error) {
      if (!await replyKnownGameError(interaction, error)) throw error;
      return true;
    }
    if (!purchase.rolePending) {
      message = `「${purchase.item.name}」は購入済みで、ロール付与も完了しています。残高: **${purchase.points.balance} pt**`;
    } else {
      try {
        // 🔁 Discord のロール追加は冪等。/buy を再実行すると、未完了の
        // 在庫アイテムの付与を再試行でき、再課金はされない。
        await addGuildRole(deps.client, guildId, userId, purchase.item.roleId);
        deps.store.completeShopRoleGrant(guildId, userId, itemId);
        message = `「${purchase.item.name}」のロールを付与しました。残高: **${purchase.points.balance} pt**`;
      } catch (error) {
        logger.error("shop_role_grant_failed_after_purchase", {
          guild_id: guildId,
          user_id: userId,
          item_id: itemId,
          error: errorMessage(error),
        });
        message = `購入は記録されていますが、ロール付与は未完了です。再度 \`/buy item_id:${itemId}\` を実行すると、追加ポイントなしで再試行できます。残高: **${purchase.points.balance} pt**`;
      }
    }
  }
  await replyEphemeral(interaction, message);
  return true;
}

// ------------------------------------------
// 🎮 既知エラーの応答
// ------------------------------------------

// 🎮 既知のゲーム系エラーなら利用者向け文面で応答して true を返す。
async function replyKnownGameError(
  interaction: ChatInputCommandInteraction,
  error: unknown,
): Promise<boolean> {
  const message = expectedGameErrorMessage(error);
  if (message === undefined) return false;
  await replyEphemeral(interaction, message);
  return true;
}

// ==========================================
// 📌 スティッキーメッセージの再投稿
// ==========================================
// 📌 旧実装（star-events.ts の moveSticky）の移植。
// 現在のスティッキーを最下部へ移す: 先に DB 上の message_id を
// 空にして確保（claim）し、旧メッセージを削除してから新しく投稿
// する。呼び出し側は戻り値の新メッセージ ID を
// Store.updateStickyMessageId で "" から差し替える。

import { logger } from "../logger.js";
import type { StickyMessage } from "../db/index.js";
import { deleteChannelMessage, isNotFoundError, sendChannelMessage } from "./discord-ops.js";
import { errorMessage } from "./shared.js";
import type { SeitouDeps } from "./deps.js";

// 📌 スティッキーを再投稿し、新しいメッセージ ID を返す。
export async function moveSticky(deps: SeitouDeps, sticky: StickyMessage): Promise<{ id: string }> {
  const oldMessageId = sticky.messageId;
  if (oldMessageId) {
    try {
      // 📌 先に確保する: 並行する再投稿が同じ旧メッセージを二重に
      // 扱わないようにする（DB 層は message_id 不一致を例外にする）。
      deps.store.updateStickyMessageId(sticky.guildId, sticky.channelId, oldMessageId, "");
    } catch (error) {
      // 📝 設定が先に変わっていた場合は、削除だけ試みて続行する
      // （旧実装の Gateway 側は行数不一致を黙って通していた）。
      logger.warn("sticky_claim_failed", {
        guild_id: sticky.guildId,
        channel_id: sticky.channelId,
        error: errorMessage(error),
      });
    }
    try {
      await deleteChannelMessage(deps.client, sticky.channelId, oldMessageId);
    } catch (error) {
      if (!isNotFoundError(error)) {
        logger.warn("sticky_previous_message_delete_failed", {
          guild_id: sticky.guildId,
          channel_id: sticky.channelId,
          error: errorMessage(error),
        });
      }
    }
  }
  const sent = await sendChannelMessage(deps.client, sticky.channelId, sticky.content, {
    suppressMentions: true,
  });
  return { id: sent.id };
}

// ==========================================
// 📝 イベントログの送信
// ==========================================
// 📝 設定キー `log.<種別>` に送信先チャンネルがあれば、そこへ
// ログ本文を送る（旧 sendLog 相当）。ログ本文にはメッセージ本文を
// 含めない（旧実装の方針をそのまま引き継ぐ）。

import type { SeitouDeps } from "./deps.js";
import { getSetting, type StarSettingsMap } from "./settings.js";
import { sendChannelMessage } from "./discord-ops.js";
import { errorMessage } from "./shared.js";
import { logger } from "../logger.js";

// 📝 ログを送信する。送信先未設定なら何もしない。送信失敗は
// 本処理を止めないよう、警告ログに残すだけにする。
export async function sendLog(
  deps: SeitouDeps,
  settings: StarSettingsMap,
  key: string,
  content: string,
): Promise<void> {
  const channelId = getSetting<string>(settings, `log.${key}`, "");
  if (!channelId) return;
  try {
    await sendChannelMessage(deps.client, channelId, content);
  } catch (error) {
    logger.warn("log_send_failed", { key, error: errorMessage(error) });
  }
}

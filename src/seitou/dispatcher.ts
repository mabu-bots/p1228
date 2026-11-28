// ==========================================
// 💬 星燈のコマンド振り分け
// ==========================================
// 💬 旧実装（star-command-handler.ts の respondToCommand）の入口
// 部分: サーバー内チェック、管理権限チェック、グループ別ハンドラ
// への振り分け。/ping はここで応答する（グループ f）。

import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { SeitouDeps } from "./deps.js";
import { hasServerAdminPermission, isAdminCommand } from "./shared.js";
import { handleAdminCommand } from "./admin.js";
import { handlePointsCommand } from "./points.js";
import { handleVcAutoCommand } from "./vc-auto.js";
import { handleTicketCommand } from "./tickets.js";
import { handleAiCommand } from "./ai.js";
import { replyEphemeral } from "./reply.js";

// 💬 スラッシュコマンドを処理する。権限不足などの応答もここで行う。
export async function dispatchCommand(
  deps: SeitouDeps,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await replyEphemeral(interaction, "このコマンドはサーバー内で使用してください。");
    return;
  }
  const commandName = interaction.commandName;

  // 🟢 /ping（グループ f）: 応答状態確認。管理権限チェックの対象外。
  if (commandName === "ping") {
    await interaction.reply({
      content: "Pong! 星燈は正常に稼働しています。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 🔐 管理コマンドは Manage Server（または Administrator）必須。
  let subcommandName = "";
  try {
    subcommandName = interaction.options.getSubcommand();
  } catch {
    // 📝 サブコマンドを持たないコマンドでは例外になる。空のまま扱う。
  }
  if (
    isAdminCommand(commandName, subcommandName) &&
    !hasServerAdminPermission(interaction.memberPermissions?.bitfield)
  ) {
    await replyEphemeral(interaction, "この操作には「サーバー管理」権限が必要です。");
    return;
  }

  if (await handleAdminCommand(deps, interaction)) return;
  if (await handlePointsCommand(deps, interaction)) return;
  if (await handleVcAutoCommand(deps, interaction)) return;
  if (await handleTicketCommand(deps, interaction)) return;
  if (await handleAiCommand(deps, interaction)) return;

  await replyEphemeral(interaction, "このコマンドには対応していません。");
}

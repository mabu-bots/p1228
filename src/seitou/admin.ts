// ==========================================
// 🛠️ 星燈の管理コマンド群（グループ a）
// ==========================================
// 🛠️ welcome / goodbye、autorole、blacklist、logs、sticky、
// role-panel のコマンド処理と、ロールパネルのボタン処理。
// 旧実装（star-command-handler.ts）の文言と挙動をそのまま移す。

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { logger } from "../logger.js";
import type { SeitouDeps } from "./deps.js";
import { getSetting } from "./settings.js";
import { errorMessage } from "./shared.js";
import { formatAutoRoleSettings, normalizeAutoRole, type AutoRoleSettings } from "./autorole.js";
import { voiceLogSettingKey } from "./voice-log.js";
import { moveSticky } from "./sticky.js";
import { sendLog } from "./log.js";
import { replyEphemeral } from "./reply.js";
import { addGuildRole, deleteChannelMessage, isNotFoundError, sendChannelMessage } from "./discord-ops.js";

// ------------------------------------------
// 🛠️ 振り分け
// ------------------------------------------

// 🛠️ グループ (a) のコマンドなら処理して true を返す。
export async function handleAdminCommand(
  deps: SeitouDeps,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const name = interaction.commandName;
  if (!["welcome", "goodbye", "autorole", "blacklist", "logs", "sticky", "role-panel"].includes(name)) {
    return false;
  }
  const guildId = interaction.guildId!;
  const sub = interaction.options.getSubcommand();
  let message: string;

  if (name === "welcome" || name === "goodbye") {
    message = handleWelcome(deps, guildId, name, sub, interaction);
  } else if (name === "autorole") {
    const result = await handleAutorole(deps, guildId, sub, interaction);
    if (result === null) return true; // 📝 既に応答済み
    message = result;
  } else if (name === "blacklist") {
    message = handleBlacklist(deps, guildId, sub, interaction);
  } else if (name === "logs") {
    const result = handleLogs(deps, guildId, sub, interaction);
    if (result === null) {
      await replyEphemeral(interaction, "VCカテゴリー別・チャンネル別の設定には target_id が必要です。");
      return true;
    }
    message = result;
  } else if (name === "sticky") {
    message = await handleSticky(deps, guildId, sub, interaction);
  } else {
    // 🎭 role-panel は内部で応答する。
    await handleRolePanel(deps, guildId, sub, interaction);
    return true;
  }
  await replyEphemeral(interaction, message);
  return true;
}

// ------------------------------------------
// 👋 参加・退出メッセージ
// ------------------------------------------

function handleWelcome(
  deps: SeitouDeps,
  guildId: string,
  name: "welcome" | "goodbye",
  sub: string,
  interaction: ChatInputCommandInteraction,
): string {
  const key = name === "welcome" ? "member_join" : "member_leave";
  const label = name === "welcome" ? "参加" : "退出";
  if (sub === "disable") {
    deps.settings.set(guildId, key, null);
    return `${label}メッセージを無効にしました。`;
  }
  const channel = interaction.options.getChannel("channel", true);
  const message = interaction.options.getString("message", true);
  deps.settings.set(guildId, key, { channel_id: channel.id, message });
  return `${label}メッセージを設定しました。`;
}

// ------------------------------------------
// 🎭 自動ロール
// ------------------------------------------

// 🎭 結果文を返す。ロール未指定のエラーだけは内部で応答し null を返す。
async function handleAutorole(
  deps: SeitouDeps,
  guildId: string,
  sub: string,
  interaction: ChatInputCommandInteraction,
): Promise<string | null> {
  const settings = deps.settings.getAll(guildId);
  if (sub === "show") {
    return `現在の自動ロール設定 — ${formatAutoRoleSettings(settings)}`;
  }
  if (sub === "disable") {
    const target = interaction.options.getString("target") ?? "all";
    if (target === "all") {
      deps.settings.set(guildId, "autorole", null);
      return "自動ロールを無効にしました（ユーザー用・Bot用とも）。";
    }
    const current = normalizeAutoRole(getSetting<AutoRoleSettings | null>(settings, "autorole", null));
    if (target === "user") delete current.user_role_id;
    else if (target === "bot") delete current.bot_role_id;
    if (!current.user_role_id && !current.bot_role_id) {
      deps.settings.set(guildId, "autorole", null);
    } else {
      deps.settings.set(guildId, "autorole", current);
    }
    const refreshed = new Map(settings);
    refreshed.set("autorole", current.user_role_id || current.bot_role_id ? current : null);
    return `${target === "user" ? "ユーザー用" : "Bot用"}の自動ロールを無効にしました。現在の設定 — ${formatAutoRoleSettings(refreshed)}`;
  }
  // 📌 set: 指定された側だけを更新し、未指定の側は既存設定を保持する。
  const userRole = interaction.options.getRole("user_role");
  const botRole = interaction.options.getRole("bot_role");
  if (!userRole && !botRole) {
    await replyEphemeral(interaction, "user_role か bot_role のどちらかを指定してください。");
    return null;
  }
  const next = normalizeAutoRole(getSetting<AutoRoleSettings | null>(settings, "autorole", null));
  if (userRole) next.user_role_id = userRole.id;
  if (botRole) next.bot_role_id = botRole.id;
  deps.settings.set(guildId, "autorole", next);
  const refreshed = new Map(settings);
  refreshed.set("autorole", next);
  return `自動ロールを設定しました。現在の設定 — ${formatAutoRoleSettings(refreshed)}`;
}


// ------------------------------------------
// 🚫 ブラックリスト
// ------------------------------------------

function handleBlacklist(
  deps: SeitouDeps,
  guildId: string,
  sub: string,
  interaction: ChatInputCommandInteraction,
): string {
  const target = interaction.options.getUser("user", true);
  if (sub === "add") {
    deps.store.addGuildBlacklist(guildId, target.id, interaction.options.getString("reason") ?? "");
    return "ユーザーを自動ロールのブラックリストに追加しました。";
  }
  deps.store.removeGuildBlacklist(guildId, target.id);
  return "ユーザーをブラックリストから削除しました。";
}

// ------------------------------------------
// 📝 ログ設定
// ------------------------------------------

// 📝 処理できれば結果文を、target_id 不足なら null を返す。
function handleLogs(
  deps: SeitouDeps,
  guildId: string,
  sub: string,
  interaction: ChatInputCommandInteraction,
): string | null {
  const eventType = interaction.options.getString("event", true);
  const targetId = interaction.options.getString("target_id") ?? "";
  const key = voiceLogSettingKey(eventType, targetId);
  if (key === "") return null;
  if (sub === "disable") {
    deps.settings.set(guildId, `log.${key}`, null);
    return "ログ送信先を解除しました。";
  }
  const channel = interaction.options.getChannel("channel", true);
  deps.settings.set(guildId, `log.${key}`, channel.id);
  return "ログ送信先を設定しました。VCはチャンネル別設定がカテゴリー別設定より優先されます。";
}

// ------------------------------------------
// 📌 スティッキー
// ------------------------------------------

async function handleSticky(
  deps: SeitouDeps,
  guildId: string,
  sub: string,
  interaction: ChatInputCommandInteraction,
): Promise<string> {
  const channel = interaction.options.getChannel("channel", true);
  if (sub === "remove") {
    const current = deps.store.getStickyMessage(guildId, channel.id);
    deps.store.removeStickyMessage(guildId, channel.id);
    if (current?.messageId) {
      try {
        await deleteChannelMessage(deps.client, channel.id, current.messageId);
      } catch (error) {
        // 📝 既に消えているスティッキーは解除済みとして扱う。
        if (!isNotFoundError(error)) throw error;
      }
    }
    return "固定メッセージを解除しました。";
  }
  const content = interaction.options.getString("message", true);
  const current = deps.store.getStickyMessage(guildId, channel.id);
  // 📌 旧メッセージ ID を保持したまま本文を差し替え、moveSticky の
  // 確保（claim）が DB 層の契約どおりに通るようにする。
  deps.store.setStickyMessage({
    guildId,
    channelId: channel.id,
    messageId: current?.messageId ?? "",
    content,
  });
  const sent = await moveSticky(deps, {
    guildId,
    channelId: channel.id,
    messageId: current?.messageId ?? "",
    content,
  });
  deps.store.updateStickyMessageId(guildId, channel.id, "", sent.id);
  return "固定メッセージを設定しました。メンバーが投稿するたびに最下部へ再投稿します。";
}

// ------------------------------------------
// 🎭 ロールパネル
// ------------------------------------------

// 🎭 パネルの投稿・削除（応答は内部で行う）。
async function handleRolePanel(
  deps: SeitouDeps,
  guildId: string,
  sub: string,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (sub === "remove") {
    const messageId = interaction.options.getString("message_id", true);
    const channel = interaction.options.getChannel("channel", true);
    await deleteChannelMessage(deps.client, channel.id, messageId);
    deps.settings.set(guildId, `role-panel:${messageId}`, null);
    await replyEphemeral(interaction, "ロールパネルを削除しました。");
    return;
  }
  const channel = interaction.options.getChannel("channel", true);
  const title = interaction.options.getString("title", true);
  const buttons: ButtonBuilder[] = [];
  const roleIds: string[] = [];
  for (let index = 1; index <= 5; index++) {
    const role = interaction.options.getRole(`role${index}`);
    if (!role) continue;
    roleIds.push(role.id);
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`star-role:${role.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(interaction.options.getString(`label${index}`) || `ロール ${index}`),
    );
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  const sent = await sendChannelMessage(deps.client, channel.id, title, { components: [row] });
  deps.settings.set(guildId, `role-panel:${sent.id}`, roleIds);
  await replyEphemeral(interaction, "ロールパネルを投稿しました。");
}

// ------------------------------------------
// 🎭 ロールパネルのボタン処理
// ------------------------------------------

// 🎭 ボタン押下でロールを付与する（旧 handleComponent の star-role 分岐）。
export async function handleRolePanelButton(
  deps: SeitouDeps,
  interaction: ButtonInteraction,
): Promise<void> {
  const guildId = interaction.guildId ?? "";
  const userId = interaction.user.id;
  const messageId = interaction.message?.id ?? "";
  const match = /^star-role:(\d+)$/.exec(interaction.customId);
  if (!guildId || !userId || !messageId || !match) {
    await interaction.reply({ content: "無効なロールパネルです。", flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = deps.settings.getAll(guildId);
  const allowedRoles = getSetting<unknown>(settings, `role-panel:${messageId}`, []);
  const roleId = match[1]!;
  if (!Array.isArray(allowedRoles) || !allowedRoles.includes(roleId)) {
    await interaction.reply({
      content: "このロールはパネルに登録されていません。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (deps.store.isGuildBlacklisted(guildId, userId)) {
    logger.warn("role_panel_denied_by_blacklist", { guild_id: guildId, user_id: userId, event_id: interaction.id });
    await sendLog(deps, settings, "autorole_refused", `ブラックリスト対象者のロールパネル操作を拒否しました (\`${userId}\`)`);
    await interaction.reply({ content: "このサーバーではロールを付与できません。", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  try {
    await addGuildRole(deps.client, guildId, userId, roleId);
    await interaction.followUp({ content: "ロールを付与しました。", flags: MessageFlags.Ephemeral });
  } catch (error) {
    logger.error("role_panel_grant_failed", {
      guild_id: guildId,
      user_id: userId,
      role_id: roleId,
      error: errorMessage(error),
    });
    await interaction.followUp({
      content: "ロールを付与できませんでした。管理者にお問い合わせください。",
      flags: MessageFlags.Ephemeral,
    });
  }
}

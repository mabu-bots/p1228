// ==========================================
// 📨 星燈の Gateway イベント処理
// ==========================================
// 📨 旧実装（star-events.ts）の移植。discord.js のイベントを購読し、
// メンバー参加・退出・ロール変更、メッセージ（報酬・編集/削除ログ・
// スティッキー再投稿）、音声状態（VC ログ・vc-auto）を処理する。
// インメモリ状態は SeitouState に持ち、GuildCreate で再構築する。

import {
  ChannelType,
  Events,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
  type VoiceState,
} from "discord.js";
import { execLog, logger } from "../logger.js";
import type { SeitouDeps } from "./deps.js";
import { getSetting, type StarSettingsMap } from "./settings.js";
import { errorMessage, formatMemberMessage } from "./shared.js";
import { resolveAutoRoleId } from "./autorole.js";
import { resolveVoiceLogChannel, type VoiceLogKind } from "./voice-log.js";
import { gameConfigOf } from "./game.js";
import { moveSticky } from "./sticky.js";
import { sendLog } from "./log.js";
import { addGuildRole, sendChannelMessage } from "./discord-ops.js";
import { cleanupStaleTemps, handleVcAutoVoice } from "./vc-auto.js";
import { dispatchCommand } from "./dispatcher.js";
import { handleRolePanelButton } from "./admin.js";
import { handleTicketButton } from "./tickets.js";
import { SeitouState } from "./state.js";

// ------------------------------------------
// 🧰 共通
// ------------------------------------------

// 📨 ハンドラの例外を記録して握りつぶす（1イベントの失敗で Bot を
// 止めない。旧実装でも Worker はイベント単位で継続していた）。
function guard(eventName: string, run: () => Promise<void>): void {
  void run().catch((error: unknown) => {
    logger.error("event_handler_failed", { event: eventName, error: errorMessage(error) });
  });
}

// 👤 表示名の解決（旧: global_name → nick → username → id）。
function displayNameOf(member: GuildMember | PartialGuildMember): string {
  const user = member.user;
  return user.globalName || member.nickname || user.username || user.id;
}

// ------------------------------------------
// 💬 インタラクション
// ------------------------------------------

async function handleInteraction(deps: SeitouDeps, interaction: Interaction): Promise<void> {
  // 📝 オートコンプリートは旧実装どおり空の候補で応答する。
  if (interaction.isAutocomplete()) {
    await interaction.respond([]);
    return;
  }
  if (interaction.isButton()) {
    if (await handleTicketButton(deps, interaction)) return;
    if (interaction.customId.startsWith("star-role:")) {
      await handleRolePanelButton(deps, interaction);
      return;
    }
    await interaction.reply({ content: "無効なロールパネルです。", flags: 64 });
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;
  const userId = interaction.user.id;
  try {
    await dispatchCommand(deps, interaction);
    execLog(command, interaction.guildId ?? undefined, interaction.channelId, userId);
  } catch (error) {
    execLog(command, interaction.guildId ?? undefined, interaction.channelId, userId, error);
    logger.error("command_failed", { command, error: errorMessage(error) });
    // 📝 旧実装はエラー時に応答しなかったが、再実装では「応答なしで
    // ハングする」状態を避けるため、汎用の失敗文を返す（意図的な差異）。
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: "処理中にエラーが発生しました。" });
      } else if (!interaction.replied) {
        await interaction.reply({ content: "処理中にエラーが発生しました。", flags: 64 });
      }
    } catch {
      // 📝 チャンネル削除等で応答自体が届かない場合は記録のみ。
    }
  }
}

// ------------------------------------------
// 🏠 ギルドのスナップショット
// ------------------------------------------

async function handleGuildCreate(deps: SeitouDeps, guild: Guild): Promise<void> {
  const { state } = deps;
  state.guildNames.set(guild.id, guild.name);
  for (const channel of guild.channels.cache.values()) {
    if ((channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) && channel.parentId) {
      state.channelParents.set(SeitouState.key(guild.id, channel.id), channel.parentId);
    }
  }
  // 👤 メンバー全件を取り直してロール・名前のスナップショットを作る。
  // 取得できない場合はキャッシュ分だけで続行する。
  let members: Iterable<GuildMember> = guild.members.cache.values();
  try {
    members = (await guild.members.fetch()).values();
  } catch (error) {
    logger.warn("guild_members_fetch_failed", { guild_id: guild.id, error: errorMessage(error) });
  }
  for (const member of members) {
    state.memberRoles.set(SeitouState.key(guild.id, member.user.id), new Set(member.roles.cache.keys()));
    state.setMemberName(guild.id, member.user.id, displayNameOf(member));
  }
  for (const voiceState of guild.voiceStates.cache.values()) {
    if (voiceState.channelId) {
      state.voiceChannels.set(SeitouState.key(guild.id, voiceState.id), voiceState.channelId);
    }
  }
  // 🧹 再起動後に残った空の一時VCを掃除する。
  await cleanupStaleTemps(deps, guild.id);
}

// ------------------------------------------
// 👤 メンバーイベント
// ------------------------------------------

async function handleMemberAdd(deps: SeitouDeps, member: GuildMember): Promise<void> {
  const guildId = member.guild.id;
  const user = member.user;
  if (!user?.id) return;
  const isBot = !!user.bot;
  const settings = deps.settings.getAll(guildId);
  const username = displayNameOf(member);
  deps.state.setMemberName(guildId, user.id, username);

  // 📌 ブラックリストは通常ユーザーのみが対象。Bot は対象外とする。
  if (!isBot && deps.store.isGuildBlacklisted(guildId, user.id)) {
    logger.warn("automatic_role_denied_by_blacklist", { guild_id: guildId, user_id: user.id });
    await sendLog(deps, settings, "autorole_refused", `自動ロール付与を拒否しました: ${username} (\`${user.id}\`)`);
  } else {
    // 📌 ユーザー用／Bot用で付与先ロールを分ける。旧形式 { role_id } はユーザー用。
    const roleId = resolveAutoRoleId(settings, isBot);
    if (roleId) {
      try {
        await addGuildRole(deps.client, guildId, user.id, roleId);
      } catch (error) {
        logger.error("automatic_role_grant_failed", {
          guild_id: guildId,
          user_id: user.id,
          role_id: roleId,
          is_bot: isBot,
          error: errorMessage(error),
        });
        await sendLog(deps, settings, "autorole_refused", `自動ロールを付与できませんでした: ${username} (\`${user.id}\`)`);
      }
    }
  }
  // 👋 参加メッセージは通常ユーザー向けのみ（Bot 参加では送らない）。
  if (!isBot) {
    const welcome = getSetting<{ channel_id?: string; message?: string } | null>(settings, "member_join", null);
    if (welcome?.channel_id && welcome.message) {
      await sendChannelMessage(
        deps.client,
        welcome.channel_id,
        formatMemberMessage(welcome.message, user.id, username, deps.state.guildNames.get(guildId) ?? guildId),
        { suppressMentions: true },
      );
    }
  }
  deps.state.memberRoles.set(SeitouState.key(guildId, user.id), new Set(member.roles.cache.keys()));
  await sendLog(deps, settings, "member_join", `参加: ${username} (\`${user.id}\`)${isBot ? " [Bot]" : ""}`);
}

async function handleMemberRemove(
  deps: SeitouDeps,
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  const guildId = member.guild.id;
  const user = member.user;
  if (!user?.id) return;
  const isBot = !!user.bot;
  const settings = deps.settings.getAll(guildId);
  const username = displayNameOf(member);
  // 👋 退出メッセージは通常ユーザー向けのみ（Bot 退出では送らない）。
  const goodbye = !isBot
    ? getSetting<{ channel_id?: string; message?: string } | null>(settings, "member_leave", null)
    : null;
  if (goodbye?.channel_id && goodbye.message) {
    await sendChannelMessage(
      deps.client,
      goodbye.channel_id,
      formatMemberMessage(goodbye.message, user.id, username, deps.state.guildNames.get(guildId) ?? guildId),
      { suppressMentions: true },
    );
  }
  deps.state.memberRoles.delete(SeitouState.key(guildId, user.id));
  await sendLog(deps, settings, "member_leave", `退出: ${username} (\`${user.id}\`)${isBot ? " [Bot]" : ""}`);
}

async function handleMemberUpdate(
  deps: SeitouDeps,
  newMember: GuildMember,
): Promise<void> {
  const guildId = newMember.guild.id;
  const user = newMember.user;
  if (!user?.id) return;
  const username = displayNameOf(newMember);
  deps.state.setMemberName(guildId, user.id, username);
  const key = SeitouState.key(guildId, user.id);
  const nextRoles = new Set(newMember.roles.cache.keys());
  const previousRoles = deps.state.memberRoles.get(key);
  deps.state.memberRoles.set(key, nextRoles);
  // 📌 以前のロールが記録されている場合にだけ変更を記録する。
  if (previousRoles) {
    const added = [...nextRoles].filter((role) => !previousRoles.has(role));
    const removed = [...previousRoles].filter((role) => !nextRoles.has(role));
    if (added.length || removed.length) {
      const settings = deps.settings.getAll(guildId);
      await sendLog(
        deps,
        settings,
        "role_update",
        `ロール変更: ${username} (\`${user.id}\`)\n追加: ${added.join(", ") || "なし"}\n削除: ${removed.join(", ") || "なし"}`,
      );
    }
  }
}

// ------------------------------------------
// 🔊 音声状態イベント
// ------------------------------------------

async function handleVoiceStateUpdate(deps: SeitouDeps, oldState: VoiceState, newState: VoiceState): Promise<void> {
  const guildId = newState.guild.id;
  const userId = newState.id;
  if (!guildId || !userId) return;
  const key = SeitouState.key(guildId, userId);
  const oldChannel = deps.state.voiceChannels.get(key) ?? "";
  const newChannel = newState.channelId ?? "";
  if (newChannel) deps.state.voiceChannels.set(key, newChannel);
  else deps.state.voiceChannels.delete(key);
  if (oldChannel === newChannel) return;

  const settings = deps.settings.getAll(guildId);
  const kind: VoiceLogKind = !oldChannel ? "join" : !newChannel ? "leave" : "move";
  // 📌 移動は「新しいチャンネルへの入室」として解決する。
  const targetChannel = newChannel || oldChannel;
  const categoryId = deps.state.channelParents.get(SeitouState.key(guildId, targetChannel)) ?? "";
  const logChannel = resolveVoiceLogChannel(settings, targetChannel, categoryId, kind === "move" ? "join" : kind);
  if (logChannel) {
    let detail = `VC移動: <@${userId}>`;
    if (kind === "join") detail = `VC参加: <@${userId}> → <#${newChannel}>`;
    else if (kind === "leave") detail = `VC退出: <@${userId}> ← <#${oldChannel}>`;
    else detail += ` <#${oldChannel}> → <#${newChannel}>`;
    await sendChannelMessage(deps.client, logChannel, detail);
  }

  await handleVcAutoVoice(deps, guildId, userId, oldChannel, newChannel, settings);
}

// ------------------------------------------
// ✉️ メッセージイベント
// ------------------------------------------

// 📌 そのチャンネルのスティッキーを最下部へ再投稿する。
async function repostSticky(deps: SeitouDeps, guildId: string, channelId: string): Promise<void> {
  const sticky = deps.store.getStickyMessage(guildId, channelId);
  if (!sticky) return;
  const sent = await moveSticky(deps, sticky);
  deps.store.updateStickyMessageId(guildId, channelId, "", sent.id);
}

async function handleMessageCreate(deps: SeitouDeps, message: Message): Promise<void> {
  const guildId = message.guildId;
  if (!guildId || !message.author?.id || message.author.bot) return;
  const settings = deps.settings.getAll(guildId);
  // 🎮 メッセージ報酬（冪等性は台帳の event_key が担保する）。
  const game = gameConfigOf(settings);
  deps.store.earnPoints({
    guildId,
    userId: message.author.id,
    eventId: message.id,
    points: game.points_per_message,
    cooldownSeconds: game.cooldown_seconds,
    dailyLimit: game.daily_limit,
  });
  // 📌 スティッキー: 人間の投稿の後に再投稿する。スティッキー自身
  // （Bot の投稿）は author.bot で既に除外されている。
  const sticky = deps.store.getStickyMessage(guildId, message.channelId);
  if (sticky && sticky.messageId !== message.id) {
    const sent = await moveSticky(deps, sticky);
    deps.store.updateStickyMessageId(guildId, message.channelId, "", sent.id);
  }
}

async function handleMessageUpdate(deps: SeitouDeps, newMessage: Message | PartialMessage): Promise<void> {
  const guildId = newMessage.guildId;
  if (!guildId) return;
  const settings = deps.settings.getAll(guildId);
  await sendLog(deps, settings, "message_edit", `メッセージ編集: <#${newMessage.channelId}> / \`${newMessage.id}\``);
}

async function handleMessageDelete(deps: SeitouDeps, message: Message | PartialMessage): Promise<void> {
  const guildId = message.guildId;
  if (!guildId) return;
  const settings = deps.settings.getAll(guildId);
  await sendLog(deps, settings, "message_delete", `メッセージ削除: <#${message.channelId}> / \`${message.id}\``);
  const sticky = deps.store.getStickyMessage(guildId, message.channelId);
  if (sticky && sticky.messageId === message.id) {
    await repostSticky(deps, guildId, message.channelId);
  }
}

// ------------------------------------------
// 📨 購読の登録
// ------------------------------------------

export function registerSeitouEvents(deps: SeitouDeps): void {
  const { client, state } = deps;

  client.on(Events.InteractionCreate, (interaction) => {
    guard("INTERACTION_CREATE", () => handleInteraction(deps, interaction));
  });
  client.on(Events.GuildCreate, (guild) => {
    guard("GUILD_CREATE", () => handleGuildCreate(deps, guild));
  });
  client.on(Events.GuildDelete, (guild) => {
    state.clearGuild(guild.id);
  });
  const trackChannel = (guildId: string, channelId: string, type: ChannelType, parentId: string | null) => {
    const key = SeitouState.key(guildId, channelId);
    if ((type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice) && parentId) {
      state.channelParents.set(key, parentId);
    } else {
      state.channelParents.delete(key);
    }
  };
  client.on(Events.ChannelCreate, (channel) => {
    if ("guild" in channel && channel.guild) trackChannel(channel.guild.id, channel.id, channel.type, channel.parentId);
  });
  client.on(Events.ChannelUpdate, (_oldChannel, newChannel) => {
    if ("guild" in newChannel && newChannel.guild) {
      trackChannel(newChannel.guild.id, newChannel.id, newChannel.type, newChannel.parentId);
    }
  });
  client.on(Events.ChannelDelete, (channel) => {
    if ("guild" in channel && channel.guild) {
      state.channelParents.delete(SeitouState.key(channel.guild.id, channel.id));
    }
  });
  client.on(Events.GuildMemberAdd, (member) => {
    guard("GUILD_MEMBER_ADD", () => handleMemberAdd(deps, member));
  });
  client.on(Events.GuildMemberRemove, (member) => {
    guard("GUILD_MEMBER_REMOVE", () => handleMemberRemove(deps, member));
  });
  client.on(Events.GuildMemberUpdate, (_oldMember, newMember) => {
    guard("GUILD_MEMBER_UPDATE", () => handleMemberUpdate(deps, newMember));
  });
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    guard("VOICE_STATE_UPDATE", () => handleVoiceStateUpdate(deps, oldState, newState));
  });
  client.on(Events.MessageCreate, (message) => {
    guard("MESSAGE_CREATE", () => handleMessageCreate(deps, message));
  });
  client.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
    guard("MESSAGE_UPDATE", () => handleMessageUpdate(deps, newMessage));
  });
  client.on(Events.MessageDelete, (message) => {
    guard("MESSAGE_DELETE", () => handleMessageDelete(deps, message));
  });
  client.on(Events.MessageBulkDelete, (messages, channel) => {
    guard("MESSAGE_DELETE_BULK", async () => {
      const guildId = channel.guildId;
      if (!guildId) return;
      const settings: StarSettingsMap = deps.settings.getAll(guildId);
      const ids = [...messages.keys()];
      await sendLog(deps, settings, "message_delete", `${ids.length}件のメッセージを一括削除: <#${channel.id}>`);
      const sticky = deps.store.getStickyMessage(guildId, channel.id);
      if (sticky && ids.includes(sticky.messageId)) {
        await repostSticky(deps, guildId, channel.id);
      }
    });
  });
}

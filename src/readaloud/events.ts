// ==========================================
// 📨 読み上げ Bot のイベント処理
// ==========================================
// 📨 スラッシュコマンド（/join /leave /say）、メッセージ自動
// 読み上げ、Bot だけになったチャンネルからの自動退出を配線する。
// 応答文と defer → 編集の流れは旧 Worker の実装に合わせてある。
// 全スラッシュコマンドは [exec] 統一形式で記録する（DESIGN §3.4）。

import {
  Events,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
} from "discord.js";
import type { BotId } from "../config.js";
import { execLog, logger } from "../logger.js";
import type { ReadAloudVoiceService } from "./service.js";

// ------------------------------------------
// 🧩 依存
// ------------------------------------------

export interface ReadAloudDeps {
  // 🤖 Bot の識別子（read_aloud_a / read_aloud_b）
  botId: BotId;
  // 🤖 discord.js のクライアント
  client: Client;
  // 🔊 読み上げ音声サービス
  service: ReadAloudVoiceService;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------
// 📨 イベント登録
// ------------------------------------------

export function registerReadAloudEvents(deps: ReadAloudDeps): void {
  const { client, service } = deps;

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(deps, interaction).catch((error: unknown) => {
      logger.error("read_aloud_interaction_failed", {
        bot_id: deps.botId,
        error: errorMessage(error),
      });
    });
  });

  // 🔊 VC 参加中ギルドの投稿を自動で読み上げる。Bot の投稿・
  // Guild 外・空本文は対象外（旧実装と同じ条件）。
  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot || !message.guildId || !message.content) return;
    void service
      .maybeReadMessage(message.guildId, message.author.id, message.content)
      .catch((error: unknown) => {
        logger.warn("message_read_failed", {
          bot_id: deps.botId,
          guild_id: message.guildId ?? undefined,
          error: errorMessage(error),
        });
      });
  });

  // 🔊 Bot が接続中のチャンネルから人がいなくなったら退出する。
  // 対象チャンネルに関わる状態変化のときだけ数え直す。
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const guildId = newState.guild.id;
    const channelId = service.sessionChannelId(guildId);
    if (!channelId) return;
    if (oldState.channelId !== channelId && newState.channelId !== channelId) return;
    const channel = newState.guild.channels.cache.get(channelId);
    if (!channel || !channel.isVoiceBased()) return;
    const nonBotMembers = channel.members.filter((member) => !member.user.bot).size;
    void service.leaveIfAlone(guildId, nonBotMembers).catch((error: unknown) => {
      logger.warn("voice_auto_leave_failed", {
        bot_id: deps.botId,
        guild_id: guildId,
        error: errorMessage(error),
      });
    });
  });
}

// ------------------------------------------
// 💬 コマンド処理
// ------------------------------------------

async function handleInteraction(deps: ReadAloudDeps, interaction: Interaction): Promise<void> {
  const { service } = deps;
  // ⌨️ オートコンプリートは旧実装と同じく空の候補で応答する。
  if (interaction.isAutocomplete()) {
    await interaction.respond([]);
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  const command: ChatInputCommandInteraction = interaction;
  const name = command.commandName;
  const guildId = command.guildId ?? "";
  const userId = command.user.id;

  if (name === "join") {
    const channel = command.options.getChannel("channel");
    if (!channel) {
      await command.reply({
        content: "接続先ボイスチャンネルを指定してください。",
        flags: MessageFlags.Ephemeral,
      });
      execLog(name, guildId || undefined, command.channelId, userId);
      return;
    }
    await command.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const guild = command.guild;
      if (!guild) throw new Error("guild_id and channel_id are required");
      await service.join(guildId, channel.id, guild.voiceAdapterCreator);
      await command.editReply({ content: "ボイスチャンネルへの接続要求を送信しました。" });
      execLog(name, guildId || undefined, command.channelId, userId);
    } catch (error) {
      await command.editReply({ content: `接続に失敗しました: ${errorMessage(error)}` });
      execLog(name, guildId || undefined, command.channelId, userId, error);
    }
    return;
  }

  if (name === "leave") {
    try {
      await service.leave(guildId);
      await command.reply({
        content: "ボイスチャンネルから退出しました。",
        flags: MessageFlags.Ephemeral,
      });
      execLog(name, guildId || undefined, command.channelId, userId);
    } catch (error) {
      execLog(name, guildId || undefined, command.channelId, userId, error);
      if (!command.replied && !command.deferred) {
        await command.reply({
          content: `退出に失敗しました: ${errorMessage(error)}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
    return;
  }

  if (name === "say") {
    const text = command.options.getString("text") ?? "";
    if (!text.trim()) {
      await command.reply({
        content: "読み上げる文章を入力してください。",
        flags: MessageFlags.Ephemeral,
      });
      execLog(name, guildId || undefined, command.channelId, userId);
      return;
    }
    await command.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await service.speak(guildId, text, userId);
      await command.editReply({ content: "読み上げキューに追加しました。" });
      execLog(name, guildId || undefined, command.channelId, userId);
    } catch (error) {
      await command.editReply({ content: `読み上げに失敗しました: ${errorMessage(error)}` });
      execLog(name, guildId || undefined, command.channelId, userId, error);
    }
    return;
  }

  await command.reply({
    content: `未実装のコマンドです: ${name}`,
    flags: MessageFlags.Ephemeral,
  });
  execLog(name, guildId || undefined, command.channelId, userId);
}

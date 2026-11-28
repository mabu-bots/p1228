// ==========================================
// 💬 読み上げ Bot のスラッシュコマンド定義
// ==========================================
// 💬 登録用 JSON の正。言ノ葉・紡言で共通の3件（/join /leave /say）。
// 旧実装（workers/src/sync-commands.ts）の定義と、名前・説明・
// オプション・チャンネル種別・最大長を一致させてある。

import {
  ChannelType,
  SlashCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

// ------------------------------------------
// 💬 コマンド定義（3件）
// ------------------------------------------

const join = new SlashCommandBuilder()
  .setName("join")
  .setDescription("指定したボイスチャンネルに接続します")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("接続先チャンネル")
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
  );

const leave = new SlashCommandBuilder()
  .setName("leave")
  .setDescription("ボイスチャンネルから退出します");

const say = new SlashCommandBuilder()
  .setName("say")
  .setDescription("指定した文章を読み上げます")
  .addStringOption((option) =>
    option.setName("text").setDescription("読み上げる文章").setRequired(true).setMaxLength(1000),
  );

// 💬 登録用の JSON 配列（Bot 起動時にまとめて登録する）。
export const READ_ALOUD_COMMANDS: RESTPostAPIApplicationCommandsJSONBody[] = [
  join.toJSON(),
  leave.toJSON(),
  say.toJSON(),
];

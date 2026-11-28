// ==========================================
// 📤 Discord 操作の薄いラッパー
// ==========================================
// 📤 旧実装では Gateway の operation allowlist 経由だった Discord
// 操作を、再実装では discord.js で直接行う。ここは「チャンネルを
// 引いて操作する」定型処理だけを集めた層で、機能判断は持たない。
// 冪等性のための operation_id は新構成では不要なため引き継がない。

import {
  ChannelType,
  DiscordAPIError,
  type Client,
  type ForumChannel,
  type Guild,
  type Message,
  type OverwriteType,
  type TextChannel,
} from "discord.js";

// ------------------------------------------
// 🧰 型とエラー判定
// ------------------------------------------

// 🔐 権限上書きの指定（旧実装の保存形式と同じ文字列ビット表現）。
export interface OverwriteSpec {
  id: string;
  // 0 = ロール、1 = メンバー
  type: 0 | 1;
  allow: string;
  deny: string;
}

// 🔍 「既に存在しない」エラーかどうか（404 / Unknown Channel 等）。
export function isNotFoundError(error: unknown): boolean {
  if (error instanceof DiscordAPIError) {
    return error.status === 404 || error.code === 10003 || error.code === 10008;
  }
  return false;
}

async function fetchGuild(client: Client, guildId: string): Promise<Guild> {
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
  return guild;
}

async function fetchTextChannel(client: Client, channelId: string): Promise<TextChannel> {
  const channel = await client.channels.fetch(channelId);
  if (channel === null || channel.type !== ChannelType.GuildText) {
    throw new Error(`channel ${channelId} is not a guild text channel`);
  }
  return channel;
}

// ------------------------------------------
// 📤 メッセージ
// ------------------------------------------

// 📤 テキストチャンネルへメッセージを送る。
export async function sendChannelMessage(
  client: Client,
  channelId: string,
  content: string,
  options: {
    components?: unknown[];
    suppressMentions?: boolean;
  } = {},
): Promise<Message> {
  const channel = await fetchTextChannel(client, channelId);
  return channel.send({
    content,
    ...(options.components ? { components: options.components as never[] } : {}),
    ...(options.suppressMentions ? { allowedMentions: { parse: [] } } : {}),
  });
}

// 🗑️ メッセージを削除する。
export async function deleteChannelMessage(
  client: Client,
  channelId: string,
  messageId: string,
): Promise<void> {
  const channel = await fetchTextChannel(client, channelId);
  await channel.messages.delete(messageId);
}

// 📜 チャンネルの直近メッセージを古い順で返す（チケット転記用）。
export async function listChannelMessages(
  client: Client,
  channelId: string,
  limit: number,
): Promise<{ timestamp: string; authorName: string; content: string }[]> {
  const channel = await fetchTextChannel(client, channelId);
  const fetched = await channel.messages.fetch({ limit });
  return [...fetched.values()].reverse().map((message) => ({
    timestamp: message.createdAt.toISOString(),
    authorName: message.author.globalName ?? message.author.username,
    content: message.content ?? "",
  }));
}

// ------------------------------------------
// 🎭 ロール・メンバー
// ------------------------------------------

// 🎭 メンバーへロールを付与する（Discord 側は冪等）。
export async function addGuildRole(
  client: Client,
  guildId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  const guild = await fetchGuild(client, guildId);
  const member = await guild.members.fetch(userId);
  await member.roles.add(roleId);
}

// 🚶 メンバーをボイスチャンネルへ移動する。
export async function moveGuildMember(
  client: Client,
  guildId: string,
  userId: string,
  channelId: string,
): Promise<void> {
  const guild = await fetchGuild(client, guildId);
  const member = await guild.members.fetch(userId);
  await member.voice.setChannel(channelId);
}

// ------------------------------------------
// 📁 チャンネル
// ------------------------------------------

// 📁 チャンネルを作成する（種別はテキスト 0 / ボイス 2 のみ使う）。
export async function createGuildChannel(
  client: Client,
  guildId: string,
  spec: {
    name: string;
    type: 0 | 2;
    parentId?: string;
    overwrites?: OverwriteSpec[];
  },
): Promise<{ id: string }> {
  const guild = await fetchGuild(client, guildId);
  const created = await guild.channels.create({
    name: spec.name,
    type: spec.type === 2 ? ChannelType.GuildVoice : ChannelType.GuildText,
    ...(spec.parentId ? { parent: spec.parentId } : {}),
    ...(spec.overwrites
      ? {
          permissionOverwrites: spec.overwrites.map((overwrite) => ({
            id: overwrite.id,
            type: overwrite.type as OverwriteType,
            allow: BigInt(overwrite.allow),
            deny: BigInt(overwrite.deny),
          })),
        }
      : {}),
  });
  return { id: created.id };
}

// 🗑️ チャンネルを削除する。
export async function deleteGuildChannel(client: Client, channelId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (channel === null) throw new Error(`channel ${channelId} not found`);
  await channel.delete();
}

// 🧵 フォーラムへスレッドを作成する（チケット記録用）。
export async function createForumThread(
  client: Client,
  channelId: string,
  name: string,
  content: string,
): Promise<{ id: string }> {
  const channel = await client.channels.fetch(channelId);
  if (channel === null || channel.type !== ChannelType.GuildForum) {
    throw new Error(`channel ${channelId} is not a forum channel`);
  }
  const thread = await (channel as ForumChannel).threads.create({
    name,
    message: { content },
  });
  return { id: thread.id };
}

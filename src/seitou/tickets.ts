// ==========================================
// 🎫 星燈のチケットと月隠れ相談（グループ d）
// ==========================================
// 🎫 /ticket・/tsukigakure のコマンド処理、パネルのボタン処理、
// 開設・クローズの本体。旧実装（star-tickets.ts）の挙動と文言を
// そのまま移す。月隠れは処罰ではなく居場所の確保であり、相手へ
// 通知しない・通常の対応記録へ転記しない、が旧来の方針。

import {
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
MessageFlags,
type ButtonInteraction,
type ChatInputCommandInteraction,
} from "discord.js";
import { logger} from "../logger.js";
import type { SeitouDeps} from "./deps.js";
import { getSetting, type StarSettingsMap} from "./settings.js";
import { errorMessage, hasServerAdminPermission} from "./shared.js";
import {
createForumThread,
createGuildChannel,
deleteGuildChannel,
listChannelMessages,
sendChannelMessage,
type OverwriteSpec,
} from "./discord-ops.js";
import { tempVoiceChannelName} from "./vc-auto.js";
import { replyEphemeral} from "./reply.js";

// ------------------------------------------
// 🎫 型
// ------------------------------------------

export interface TicketConfig {
category_id: string;
staff_role_id: string;
record_channel_id?: string;
}

export interface TicketRecord {
user_id: string;
kind: "general" | "tsukigakure";
opened_at: string;
}

type TicketKind = TicketRecord["kind"];

// ------------------------------------------
// 🔐 権限上書き（純粋ロジック）
// ------------------------------------------
// 🔐 権限ビット: VIEW_CHANNEL=1024, SEND_MESSAGES=2048,
// CONNECT=1048576, SPEAK=2097152

// 🔐 テキスト用: 全体には見せず、本人と担当ロールだけが読み書きできる。
export function privateOverwrites(guildId: string, userId: string, roleId: string): OverwriteSpec[] {
return [
{ id: guildId, type: 0, allow: "0", deny: "1024"},
{ id: userId, type: 1, allow: "3072", deny: "0"},
{ id: roleId, type: 0, allow: "3072", deny: "0"},
];
}

// 🔌 月隠れ用VC: 全体には見せず・接続させず、相談者と担当だけが使える。
// 指定した相手は CONNECT を拒否する（処罰ではなく居場所の確保。
// 相手へは通知されない）。
export function privateVoiceOverwrites(
guildId: string,
memberId: string,
roleId: string,
blockId: string,
): OverwriteSpec[] {
return [
{ id: guildId, type: 0, allow: "0", deny: "1049600"},
{ id: memberId, type: 1, allow: "3146752", deny: "0"},
{ id: roleId, type: 0, allow: "3146752", deny: "0"},
{ id: blockId, type: 1, allow: "0", deny: "1048576"},
];
}

// ------------------------------------------
// 📜 転記の整形（純粋ロジック）
// ------------------------------------------

// 📜 転記本文を Discord の上限に収まる塊へ分ける（改行位置を優先）。
export function chunkTranscript(text: string, size = 1900): string[] {
const chunks: string[] = [];
let rest = text;
while (rest.length > size) {
let cut = rest.lastIndexOf("\n", size);
if (cut <= 0) cut = size;
chunks.push(rest.slice(0, cut));
rest = rest.slice(cut).replace(/^\n/, "");
}
if (rest) chunks.push(rest);
return chunks;
}

// 📜 メッセージ列を転記行へ整形する（本文のあるものだけ、古い順）。
export function buildTranscriptLines(
messages: { timestamp: string; authorName: string; content: string}[],
): string[] {
return messages
.filter((item) => (item.content?? "").trim())
.map((item) => `[${item.timestamp?? ""}] ${item.authorName?? "unknown"}: ${item.content}`);
}

// ------------------------------------------
// 🎫 設定の読み出し
// ------------------------------------------

function ticketConfigOf(settings: StarSettingsMap, kind: TicketKind): TicketConfig | null {
return getSetting<TicketConfig | null>(
settings,
kind === "tsukigakure"? "tsukigakure.config": "ticket.config",
null,
);
}

function ticketChannelsOf(settings: StarSettingsMap): Record<string, TicketRecord> {
return getSetting<Record<string, TicketRecord>>(settings, "ticket.channels", {});
}

// ------------------------------------------
// 🎫 開設
// ------------------------------------------

// 🎫 チケットチャンネルを開く。既に同じ種別を開いていればその
// チャンネルを返す（1人1件）。
export async function openTicketChannel(
deps: SeitouDeps,
guildId: string,
userId: string,
kind: TicketKind,
eventId: string,
): Promise<{ channelId?: string; error?: string}> {
const settings = deps.settings.getAll(guildId);
const config = ticketConfigOf(settings, kind);
if (!config) return { error: "受付の設定がまだ完了していません。管理者にお問い合わせください。"};
const channels = ticketChannelsOf(settings);
const existing = Object.entries(channels).find(([, record]) => record.user_id === userId && record.kind === kind);
if (existing) return { channelId: existing[0]};
const username = deps.state.memberName(guildId, userId, "メンバー");
const created = await createGuildChannel(deps.client, guildId, {
name: kind === "tsukigakure"? `月隠れ相談-${username}`: `チケット-${username}`,
type: 0,
parentId: config.category_id,
overwrites: privateOverwrites(guildId, userId, config.staff_role_id),
});
channels[created.id] = { user_id: userId, kind, opened_at: new Date().toISOString()};
deps.settings.set(guildId, "ticket.channels", channels);
const intro =
kind === "tsukigakure"
? `<@${userId}> さんの月隠れ相談です。このチャンネルは相談者と月隠れ担当だけが見られます。内容は通常の対応記録には残しません。終わったら「クローズ」ボタンで閉じてください。`
: `<@${userId}> さんのチケットです。運営が対応します。終わったら「クローズ」ボタンで閉じてください（記録先フォーラムへ転記されます）。`;
const closeButton = new ButtonBuilder()
.setCustomId("ticket:close")
.setStyle(ButtonStyle.Danger)
.setLabel("クローズ");
const row = new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton);
await sendChannelMessage(deps.client, created.id, intro, { components: [row]});
return { channelId: created.id};
}

// ------------------------------------------
// 🎫 クローズ
// ------------------------------------------

async function closeTicketChannel(
deps: SeitouDeps,
guildId: string,
channelId: string,
closedBy: string,
closedByIsAdmin: boolean,
eventId: string,
): Promise<string> {
const settings = deps.settings.getAll(guildId);
const channels = ticketChannelsOf(settings);
const record = channels[channelId];
if (!record) return "このチャンネルはチケットではありません。";
if (record.user_id!== closedBy &&!closedByIsAdmin) {
return "クローズできるのはチケットを開いた本人と運営だけです。";
}

if (record.kind === "general") {
const config = ticketConfigOf(settings, "general");
if (config?.record_channel_id) {
try {
const messages = await listChannelMessages(deps.client, channelId, 100);
const lines = buildTranscriptLines(messages);
const thread = await createForumThread(
deps.client,
config.record_channel_id,
`チケット記録 ${record.opened_at.slice(0, 10)} ${record.user_id}`,
`チケット対応記録\n開設者: <@${record.user_id}>\n開設日時: ${record.opened_at}\nクローズ者: <@${closedBy}>\n記録メッセージ数: ${lines.length}`,
);
const chunks = chunkTranscript(lines.join("\n") || "（本文のあるメッセージはありませんでした）");
for (const chunk of chunks) {
await sendChannelMessage(deps.client, thread.id, chunk);
}
} catch (error) {
logger.error("ticket_record_failed", { guild_id: guildId, channel_id: channelId, error: errorMessage(error)});
return "対応記録への転記に失敗したため、チケットは削除しませんでした。運営に連絡してください。";
}
}
}

delete channels[channelId];
deps.settings.set(guildId, "ticket.channels", channels);
await deleteGuildChannel(deps.client, channelId);
return record.kind === "tsukigakure"
? "月隠れ相談をクローズしました。記録は残していません。"
: "チケットをクローズしました。";
}

// 🔄 クローズ処理の例外を利用者向けの結果文へ変換する（ボタンと
// コマンドで共通）。結果は必ず実行した本人へ返すこととし、失敗の
// 理由はログにも残す。
export async function closeTicketSafely(
deps: SeitouDeps,
guildId: string,
channelId: string,
closedBy: string,
closedByIsAdmin: boolean,
eventId: string,
): Promise<string> {
try {
return await closeTicketChannel(deps, guildId, channelId, closedBy, closedByIsAdmin, eventId);
} catch (error) {
logger.error("ticket_close_failed", { guild_id: guildId, channel_id: channelId, error: errorMessage(error)});
return "チケットのクローズに失敗しました。運営に連絡してください。";
}
}

// ------------------------------------------
// 🎫 コマンド処理
// ------------------------------------------

// 🎫 グループ (d) のコマンドなら処理して true を返す。
export async function handleTicketCommand(
deps: SeitouDeps,
interaction: ChatInputCommandInteraction,
): Promise<boolean> {
const name = interaction.commandName;
if (name!== "ticket" && name!== "tsukigakure") return false;
const guildId = interaction.guildId!;
const sub = interaction.options.getSubcommand();
let message: string;

if (name === "ticket" && sub === "panel") {
// ------------------------------------------
// 🎫 チケット受付パネル
// ------------------------------------------
const config: TicketConfig = {
category_id: interaction.options.getChannel("category", true).id,
staff_role_id: interaction.options.getRole("staff_role", true).id,
...(interaction.options.getChannel("record_channel")
? { record_channel_id: interaction.options.getChannel("record_channel")!.id}
: {}),
};
deps.settings.set(guildId, "ticket.config", config);
const button = new ButtonBuilder()
.setCustomId("ticket:open:general")
.setStyle(ButtonStyle.Primary)
.setLabel("チケットを開く");
const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
await sendChannelMessage(
deps.client,
interaction.options.getChannel("channel", true).id,
"\n運営への個別相談はこちらからチケットを開いてください。チケット内はあなたと運営だけが見られます。",
{ components: [row]},
);
message = "チケット受付パネルを投稿しました。";
} else if (name === "ticket") {
// 🎫 ticket close
message = await closeTicketSafely(
deps,
guildId,
interaction.channelId,
interaction.user.id,
hasServerAdminPermission(interaction.memberPermissions?.bitfield),
interaction.id,
);
} else if (sub === "panel") {
// ------------------------------------------
// 🌙 月隠れ受付パネル
// ------------------------------------------
const config: TicketConfig = {
category_id: interaction.options.getChannel("category", true).id,
staff_role_id: interaction.options.getRole("staff_role", true).id,
};
deps.settings.set(guildId, "tsukigakure.config", config);
const button = new ButtonBuilder()
.setCustomId("ticket:open:tsukigakure")
.setStyle(ButtonStyle.Secondary)
.setLabel("月隠れ相談をする");
const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
await sendChannelMessage(
deps.client,
interaction.options.getChannel("channel", true).id,
"\n特定のメンバーとの相性や人間関係で浮上しづらい方は、こちらから非公開で相談できます。相談内容は月隠れ担当だけが閲覧し、通常の対応記録には残しません。苦手という理由だけで相手が処罰されることはありません。",
{ components: [row]},
);
message = "月隠れ相談の受付パネルを投稿しました。";
} else if (sub === "room") {
// ------------------------------------------
// 🌙 月隠れ: 限定チャンネル
// ------------------------------------------
const config = ticketConfigOf(deps.settings.getAll(guildId), "tsukigakure");
if (!config) {
message = "先に /tsukigakure panel で担当ロールとカテゴリーを設定してください。";
} else {
const member = interaction.options.getUser("member", true);
const username = deps.state.memberName(guildId, member.id, member.id);
const created = await createGuildChannel(deps.client, guildId, {
name: `月隠れ-${username}`,
type: 0,
parentId: config.category_id,
overwrites: privateOverwrites(guildId, member.id, config.staff_role_id),
});
await sendChannelMessage(
deps.client,
created.id,
`<@${member.id}> さんの専用チャンネルです。このチャンネルは相談者と月隠れ担当だけが見られます。`,
);
message = `限定チャンネル <#${created.id}> を作成しました。`;
}
} else {
// ------------------------------------------
// 🌙 月隠れ: 専用 VC
// ------------------------------------------
const config = ticketConfigOf(deps.settings.getAll(guildId), "tsukigakure");
if (!config) {
message = "先に /tsukigakure panel で担当ロールとカテゴリーを設定してください。";
} else {
const member = interaction.options.getUser("member", true);
const block = interaction.options.getUser("block", true);
const username = deps.state.memberName(guildId, member.id, member.id);
const created = await createGuildChannel(deps.client, guildId, {
name: tempVoiceChannelName(username),
type: 2,
parentId: config.category_id,
overwrites: privateVoiceOverwrites(guildId, member.id, config.staff_role_id, block.id),
});
message = `専用VC <#${created.id}> を作成しました。指定した相手はこのVCに接続できません（相手へ通知はされません）。`;
}
}
await replyEphemeral(interaction, message);
return true;
}

// ------------------------------------------
// 🎫 ボタン処理
// ------------------------------------------

// 🎫 チケット系ボタン（open / close）を処理する。対象外なら false。
export async function handleTicketButton(deps: SeitouDeps, interaction: ButtonInteraction): Promise<boolean> {
const customId = interaction.customId;
if (customId === "ticket:open:general" || customId === "ticket:open:tsukigakure") {
const kind: TicketKind = customId === "ticket:open:tsukigakure"? "tsukigakure": "general";
const guildId = interaction.guildId?? "";
try {
const result = await openTicketChannel(deps, guildId, interaction.user.id, kind, interaction.id);
await interaction.reply({
content: result.channelId? `受付しました: <#${result.channelId}>`: (result.error?? "作成に失敗しました。"),
flags: MessageFlags.Ephemeral,
});
} catch (error) {
logger.error("ticket_open_failed", {
guild_id: guildId,
user_id: interaction.user.id,
kind,
error: errorMessage(error),
});
await interaction.reply({
content: "チケットの作成に失敗しました。管理者にお問い合わせください。",
flags: MessageFlags.Ephemeral,
});
}
return true;
}
if (customId === "ticket:close") {
const guildId = interaction.guildId?? "";
const channelId = interaction.channelId;
const settings = deps.settings.getAll(guildId);
const record = ticketChannelsOf(settings)[channelId];
if (!record) {
await interaction.reply({ content: "このチャンネルはチケットではありません。", flags: MessageFlags.Ephemeral});
return true;
}
const isAdmin = hasServerAdminPermission(interaction.memberPermissions?.bitfield);
if (record.user_id!== interaction.user.id &&!isAdmin) {
await interaction.reply({
content: "クローズできるのはチケットを開いた本人と運営だけです。",
flags: MessageFlags.Ephemeral,
});
return true;
}
// 🗑️ 結果（転記失敗で削除しなかった等）を押した本人へ届けるため、
// 先に defer してから結果文で元の応答を編集する（/ticket close
// コマンドと同じ結果文）。
await interaction.deferReply({ flags: MessageFlags.Ephemeral});
const outcome = await closeTicketSafely(deps, guildId, channelId, interaction.user.id, isAdmin, interaction.id);
logger.info("ticket_closed", { guild_id: guildId, channel_id: channelId, kind: record.kind, outcome});
try {
await interaction.editReply({ content: outcome});
} catch (error) {
// 🗑️ クローズ成功時はチャンネルごと削除されるため、元の応答を
// 編集できないことがある。その場合はチャンネルの消滅自体が
// 結果として伝わるので、記録だけ残して再送はしない。
logger.info("ticket_close_result_undelivered", {
guild_id: guildId,
channel_id: channelId,
error: errorMessage(error),
});
}
return true;
}
return false;
}

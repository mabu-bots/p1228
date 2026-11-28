// ==========================================
// 🔊 星燈のVC自動生成（グループ c）
// ==========================================
// 🔊 /vc-auto のコマンド処理と、音声イベントに連動する一時 VC の
// 生成・削除・残存掃除。旧実装（star-vc-auto.ts）の挙動をそのまま
// 移す。設定は `vcauto.lobbies` / `vcauto.temps` に保存する。

import type { ChatInputCommandInteraction } from "discord.js";
import { logger } from "../logger.js";
import type { SeitouDeps } from "./deps.js";
import { getSetting, type StarSettingsMap } from "./settings.js";
import { errorMessage } from "./shared.js";
import { createGuildChannel, deleteGuildChannel, isNotFoundError, moveGuildMember } from "./discord-ops.js";
import { replyEphemeral } from "./reply.js";

// ------------------------------------------
// 🔊 型
// ------------------------------------------

export interface VcAutoLobby {
  lobby_id: string;
  category_id: string;
}

export interface VcAutoTemp {
  channel_id: string;
  owner_id: string;
}

// 🔊 一時 VC の名前（「<名前>のVC」。名前が空なら「専用VC」）。
export function tempVoiceChannelName(username: string): string {
  const cleaned = username.replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned ? `${cleaned}のVC` : "専用VC";
}

function lobbiesOf(settings: StarSettingsMap): VcAutoLobby[] {
  return getSetting<VcAutoLobby[]>(settings, "vcauto.lobbies", []);
}

function tempsOf(settings: StarSettingsMap): VcAutoTemp[] {
  return getSetting<VcAutoTemp[]>(settings, "vcauto.temps", []);
}

// ------------------------------------------
// 🔊 コマンド処理
// ------------------------------------------

// 🔊 グループ (c) のコマンドなら処理して true を返す。
export async function handleVcAutoCommand(
  deps: SeitouDeps,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (interaction.commandName !== "vc-auto") return false;
  const guildId = interaction.guildId!;
  const sub = interaction.options.getSubcommand();
  const settings = deps.settings.getAll(guildId);
  const lobbies = lobbiesOf(settings);
  let message: string;

  if (sub === "set") {
    const lobby = interaction.options.getChannel("lobby", true);
    const category = interaction.options.getChannel("category", true);
    const next = [
      ...lobbies.filter((entry) => entry.lobby_id !== lobby.id),
      { lobby_id: lobby.id, category_id: category.id },
    ];
    deps.settings.set(guildId, "vcauto.lobbies", next);
    message = `ロビー <#${lobby.id}> を登録しました。参加すると専用VCを自動生成し、空になると削除します。`;
  } else if (sub === "remove") {
    const lobby = interaction.options.getChannel("lobby", true);
    deps.settings.set(
      guildId,
      "vcauto.lobbies",
      lobbies.filter((entry) => entry.lobby_id !== lobby.id),
    );
    message = `ロビー <#${lobby.id}> の登録を解除しました。`;
  } else {
    const temps = tempsOf(settings);
    const lobbyText = lobbies.length
      ? lobbies.map((entry) => `<#${entry.lobby_id}> → カテゴリー <#${entry.category_id}>`).join("\n")
      : "なし";
    const tempText = temps.length
      ? temps.map((entry) => `<#${entry.channel_id}>（<@${entry.owner_id}>）`).join("\n")
      : "なし";
    message = `**ロビー登録**\n${lobbyText}\n**生成中の一時VC**\n${tempText}`;
  }
  await replyEphemeral(interaction, message);
  return true;
}

// ------------------------------------------
// 🗑️ 一時 VC の削除
// ------------------------------------------

// 🗑️ 一時VCを削除する。成功（または既に存在しない）場合は記録から
// 取り除いた配列を返し、削除できなかった場合は元の配列をそのまま
// 返す（記録を残し、次回の掃除で再試行する）。
async function deleteVcAutoTemp(
  deps: SeitouDeps,
  guildId: string,
  temps: VcAutoTemp[],
  channelId: string,
): Promise<VcAutoTemp[]> {
  try {
    await deleteGuildChannel(deps.client, channelId);
    return temps.filter((entry) => entry.channel_id !== channelId);
  } catch (error) {
    if (isNotFoundError(error)) return temps.filter((entry) => entry.channel_id !== channelId);
    logger.error("vcauto_delete_failed", { guild_id: guildId, channel_id: channelId, error: errorMessage(error) });
    return temps;
  }
}

// 🧹 残存掃除: 過去の失敗で空のまま残った一時VCを、再起動を待たずに
// 音声イベントのタイミングで回収する。所有者がロビーにいる一時VCは、
// 移動が音声イベントとして未着の可能性があるため対象にしない。
async function sweepVcAutoTemps(
  deps: SeitouDeps,
  guildId: string,
  temps: VcAutoTemp[],
  exclude: Set<string>,
  lobbyIds: Set<string>,
): Promise<VcAutoTemp[]> {
  let result = temps;
  for (const temp of temps) {
    if (exclude.has(temp.channel_id)) continue;
    if (deps.state.countOccupants(guildId, temp.channel_id) > 0) continue;
    const ownerChannel = deps.state.voiceChannels.get(`${guildId}:${temp.owner_id}`) ?? "";
    if (lobbyIds.has(ownerChannel)) continue;
    const remaining = await deleteVcAutoTemp(deps, guildId, result, temp.channel_id);
    if (remaining !== result) {
      result = remaining;
      logger.info("vcauto_stale_channel_deleted", { guild_id: guildId, channel_id: temp.channel_id });
    }
  }
  return result;
}

// ------------------------------------------
// 🔊 音声イベント連動
// ------------------------------------------

// 🔊 ロビー参加での生成、空になった一時 VC の削除、残存掃除を行う。
export async function handleVcAutoVoice(
  deps: SeitouDeps,
  guildId: string,
  userId: string,
  oldChannel: string,
  newChannel: string,
  settings: StarSettingsMap,
): Promise<void> {
  const lobbies = lobbiesOf(settings);
  let temps = tempsOf(settings);
  let tempsDirty = false;

  // 👋 ロビーへ参加したら一時VCを作って移動する。
  if (newChannel && newChannel !== oldChannel) {
    const lobby = lobbies.find((entry) => entry.lobby_id === newChannel);
    if (lobby && !temps.some((entry) => entry.owner_id === userId)) {
      const username = deps.state.memberName(guildId, userId, "メンバー");
      let createdId = "";
      try {
        const created = await createGuildChannel(deps.client, guildId, {
          name: tempVoiceChannelName(username),
          type: 2,
          parentId: lobby.category_id,
        });
        createdId = created.id;
        temps = [...temps, { channel_id: created.id, owner_id: userId }];
        deps.settings.set(guildId, "vcauto.temps", temps);
        try {
          await moveGuildMember(deps.client, guildId, userId, created.id);
          logger.info("vcauto_channel_created", { guild_id: guildId, user_id: userId, channel_id: created.id });
        } catch (moveError) {
          // 🗑️ 作成はできたが移動できなかった場合は、その場で削除して
          // 回収する。削除もできなければ記録を残し、次回の掃除
          // （音声イベント時・GuildCreate 時）で回収する。
          logger.warn("vcauto_move_failed", {
            guild_id: guildId,
            user_id: userId,
            channel_id: createdId,
            error: errorMessage(moveError),
          });
          const remaining = await deleteVcAutoTemp(deps, guildId, temps, createdId);
          if (remaining !== temps) {
            temps = remaining;
            tempsDirty = true;
            logger.info("vcauto_orphan_channel_deleted", { guild_id: guildId, user_id: userId, channel_id: createdId });
          }
        }
      } catch (error) {
        logger.error("vcauto_create_failed", {
          guild_id: guildId,
          user_id: userId,
          channel_id: createdId,
          error: errorMessage(error),
        });
        // 📝 作成後に記録できなかったチャンネルも、可能な範囲で回収を試みる。
        if (createdId) {
          const remaining = await deleteVcAutoTemp(deps, guildId, temps, createdId);
          if (remaining !== temps) {
            temps = remaining;
            tempsDirty = true;
          }
        }
      }
    }
  }

  // 🗑️ 一時VCが空になったら削除する（退出・移動の両方を対象にする）。
  if (oldChannel && oldChannel !== newChannel && temps.some((entry) => entry.channel_id === oldChannel)) {
    if (deps.state.countOccupants(guildId, oldChannel) === 0) {
      const remaining = await deleteVcAutoTemp(deps, guildId, temps, oldChannel);
      if (remaining !== temps) {
        temps = remaining;
        tempsDirty = true;
        logger.info("vcauto_channel_deleted", { guild_id: guildId, channel_id: oldChannel });
      }
    }
  }

  // 🧹 残存掃除: このイベントに関係しない空の一時VCを回収する。
  const swept = await sweepVcAutoTemps(
    deps,
    guildId,
    temps,
    new Set([oldChannel, newChannel]),
    new Set(lobbies.map((entry) => entry.lobby_id)),
  );
  if (swept !== temps) {
    temps = swept;
    tempsDirty = true;
  }

  if (tempsDirty) deps.settings.set(guildId, "vcauto.temps", temps);
}

// 🧹 再起動後（GuildCreate 時）に残った空の一時VCを掃除する。
export async function cleanupStaleTemps(deps: SeitouDeps, guildId: string): Promise<void> {
  try {
    const settings = deps.settings.getAll(guildId);
    const temps = tempsOf(settings);
    if (temps.length === 0) return;
    const remaining: VcAutoTemp[] = [];
    for (const temp of temps) {
      if (deps.state.countOccupants(guildId, temp.channel_id) > 0) {
        remaining.push(temp);
        continue;
      }
      try {
        await deleteGuildChannel(deps.client, temp.channel_id);
        logger.info("vcauto_stale_channel_deleted", { guild_id: guildId, channel_id: temp.channel_id });
      } catch (error) {
        // 🗑️ 既に削除済みなら掃除完了として扱い、それ以外は次回に再試行する。
        if (isNotFoundError(error)) continue;
        logger.warn("vcauto_cleanup_failed", {
          guild_id: guildId,
          channel_id: temp.channel_id,
          error: errorMessage(error),
        });
        remaining.push(temp);
      }
    }
    if (remaining.length !== temps.length) deps.settings.set(guildId, "vcauto.temps", remaining);
  } catch (error) {
    logger.warn("vcauto_cleanup_skipped", { guild_id: guildId, error: errorMessage(error) });
  }
}

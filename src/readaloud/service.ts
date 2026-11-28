// ==========================================
// 🔊 読み上げ音声サービス（セッション・再生）
// ==========================================
// 🔊 Guild ごとの Voice セッションを保持し、/join /leave /say と
// メッセージ自動読み上げを担う（旧 Worker の ReadAloudVoiceService
// の再実装。旧構成の Gateway 中継アダプタは廃止し、discord.js の
// voiceAdapterCreator で直接接続する）。
// 設定解決・辞書・キュー・合成は専用モジュールへ分離してあり、
// ここは Discord の音声接続と再生の調停に専念する。
//
// ⚠️ 実音声の再生（DAVE / UDP / Opus の実地確認）は現行本番でも
// 未検証の領域（DESIGN §6-3）。ここではコードとして再生可能な
// 形にするところまでを到達点とする。

import { Readable } from "node:stream";
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  StreamType,
  type AudioPlayer,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
} from "@discordjs/voice";
import type { BotId } from "../config.js";
import type { Store } from "../db/index.js";
import { logger } from "../logger.js";
import { applyDictionary, resolveDictionary } from "./dictionary.js";
import type { AudioSynthesizer } from "./engine.js";
import { SpeechQueue, type SpeechQueueItem } from "./queue.js";
import { resolveReadAloudSettings, type ReadAloudSettings } from "./settings.js";

// ------------------------------------------
// 🧩 セッションと依存
// ------------------------------------------

interface GuildVoiceSession {
  // 🔊 @discordjs/voice の接続
  connection: VoiceConnection;
  // 🔊 再生プレイヤー
  player: AudioPlayer;
  // 🔊 接続先チャンネル ID
  channelId: string;
  // 📥 この Guild の読み上げキュー
  queue: SpeechQueue;
}

export interface ReadAloudServiceDeps {
  // 🤖 Bot の識別子（ログ用。read_aloud_a / read_aloud_b）
  botId: BotId;
  // 💾 DB 層（設定・辞書の読み取り）
  store: Store;
  // 🎙️ キャッシュつき合成
  synthesizer: AudioSynthesizer;
}

// 🔢 /say の本文上限はコマンド定義側（1,000字）で担保するが、
// 自動読み上げの本文はここで旧実装と同じ5,000字に丸める。
const MAX_SPEECH_CHARS = 5_000;

// ------------------------------------------
// 🔊 サービス本体
// ------------------------------------------

export class ReadAloudVoiceService {
  private readonly sessions = new Map<string, GuildVoiceSession>();

  constructor(private readonly deps: ReadAloudServiceDeps) {}

  // ------------------------------------------
  // 🔊 接続・退出
  // ------------------------------------------

  // 🔊 指定チャンネルへ接続する。既存セッションがあれば先に退出する
  // （旧実装と同じ）。Ready までの待機はイベントループを塞がない
  // よう非同期で行い、タイムアウトしたらセッションを破棄する。
  async join(
    guildId: string,
    channelId: string,
    adapterCreator: DiscordGatewayAdapterCreator,
  ): Promise<void> {
    if (!guildId || !channelId) throw new Error("guild_id and channel_id are required");
    await this.leave(guildId);
    const connection = joinVoiceChannel({
      guildId,
      channelId,
      adapterCreator,
      selfDeaf: true,
      selfMute: false,
      // 🔐 @discordjs/voice の DAVE 暗号化は既定で有効。無効にしないこと。
    });
    const player = createAudioPlayer();
    connection.subscribe(player);
    const session: GuildVoiceSession = {
      connection,
      player,
      channelId,
      queue: new SpeechQueue({
        processItem: (item) => this.playItem(guildId, session, item),
        onItemError: (error) =>
          logger.error("audio_item_failed", {
            bot_id: this.deps.botId,
            guild_id: guildId,
            error: error instanceof Error ? error.message : String(error),
          }),
        isActive: () =>
          this.sessions.get(guildId) === session &&
          connection.state.status !== VoiceConnectionStatus.Destroyed,
      }),
    };
    this.sessions.set(guildId, session);
    connection.on("stateChange", (_oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        if (this.sessions.get(guildId) === session) this.sessions.delete(guildId);
        logger.info("voice_connection_destroyed", { bot_id: this.deps.botId, guild_id: guildId });
      }
    });
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      // 🔄 一時的な切断は再接続を試み、失敗したら破棄する
      // （@discordjs/voice の標準的な回復手順）。
      void (async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          if (this.sessions.get(guildId) === session) connection.destroy();
        }
      })();
    });
    connection.on("error", (error) =>
      logger.error("voice_connection_error", { guild_id: guildId, error: error.message }),
    );
    player.on("error", (error) =>
      logger.error("audio_player_error", { guild_id: guildId, error: error.message }),
    );
    logger.info("voice_join_requested", {
      bot_id: this.deps.botId,
      guild_id: guildId,
      channel_id: channelId,
    });
    void entersState(connection, VoiceConnectionStatus.Ready, 25_000)
      .then(() => {
        logger.info("voice_connected", {
          bot_id: this.deps.botId,
          guild_id: guildId,
          channel_id: channelId,
        });
      })
      .catch((error: unknown) => {
        logger.error("voice_connection_timeout", {
          bot_id: this.deps.botId,
          guild_id: guildId,
          error: error instanceof Error ? error.message : String(error),
        });
        if (this.sessions.get(guildId) === session) {
          this.sessions.delete(guildId);
          connection.destroy();
        }
      });
  }

  // 🔊 退出する。セッションが無ければ何もしない（旧実装と同じ）。
  async leave(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) return;
    this.sessions.delete(guildId);
    session.queue.clear();
    session.player.stop(true);
    session.connection.destroy();
    logger.info("voice_left", { bot_id: this.deps.botId, guild_id: guildId });
  }

  // 🔊 接続中かどうか（Ready 状態のみ true。旧実装と同じ）。
  isConnected(guildId: string): boolean {
    const session = this.sessions.get(guildId);
    return session?.connection.state.status === VoiceConnectionStatus.Ready;
  }

  // 🔊 接続中チャンネルの ID（無ければ null）。自動退出の判定用。
  sessionChannelId(guildId: string): string | null {
    return this.sessions.get(guildId)?.channelId ?? null;
  }

  // 🔊 Bot だけになったら退出する。イベント層が数えた「Bot 以外の
  // 人数」が 0 のときに呼ぶ想定。
  // 📌 旧 Worker には無かった挙動で、放置された接続を残さないために
  // 再実装で追加した（パリティ差異として記録する）。
  async leaveIfAlone(guildId: string, nonBotMemberCount: number): Promise<void> {
    if (nonBotMemberCount > 0) return;
    if (!this.sessions.has(guildId)) return;
    logger.info("voice_auto_leave_alone", { bot_id: this.deps.botId, guild_id: guildId });
    await this.leave(guildId);
  }

  // ------------------------------------------
  // 🔊 読み上げ
  // ------------------------------------------

  // 🔊 文章をキューへ追加する。未接続・空文・上限は例外にする
  // （文言は旧実装と一致させてある）。
  async speak(
    guildId: string,
    rawText: string,
    userId?: string,
    settingsOverride?: Partial<ReadAloudSettings>,
  ): Promise<void> {
    const session = this.sessions.get(guildId);
    if (!session) throw new Error("BOT is not connected to a voice channel. Use /join first.");
    const text = rawText.trim().slice(0, MAX_SPEECH_CHARS);
    if (!text) throw new Error("読み上げる文章が空です。");
    const item: SpeechQueueItem = {
      text,
      ...(userId ? { userId } : {}),
      ...(settingsOverride ? { settingsOverride } : {}),
    };
    session.queue.enqueue(item);
  }

  // 🔊 メッセージの自動読み上げ判定。接続中かつ設定で有効な場合のみ
  // キューへ積む（旧実装の maybeReadMessage と同じ）。
  async maybeReadMessage(guildId: string, userId: string | undefined, text: string): Promise<void> {
    if (!guildId || !text.trim() || !this.sessions.has(guildId)) return;
    const snapshot = resolveReadAloudSettings(this.deps.store, guildId, userId);
    if (!snapshot.settings.enabled) return;
    await this.speak(guildId, text, userId);
  }

  // ------------------------------------------
  // 🔊 再生（キューからの呼び出し）
  // ------------------------------------------

  // 🔊 1件を合成して再生し、終了まで待つ。設定と辞書はこの時点で
  // 読み直し、revision をキャッシュキーへ合成する（旧実装と同じ）。
  private async playItem(
    guildId: string,
    session: GuildVoiceSession,
    item: SpeechQueueItem,
  ): Promise<void> {
    await entersState(session.connection, VoiceConnectionStatus.Ready, 25_000);
    const settingsSnapshot = resolveReadAloudSettings(this.deps.store, guildId, item.userId);
    const dictionary = resolveDictionary(this.deps.store, guildId, item.userId);
    const settings = settingsSnapshot.settings;
    const audio = await this.deps.synthesizer.synthesize({
      text: applyDictionary(item.text, dictionary.entries),
      speakerId: item.settingsOverride?.speaker_id ?? settings.speaker_id,
      speed: item.settingsOverride?.speed ?? settings.speed,
      volume: item.settingsOverride?.volume ?? settings.volume,
      cacheRevision: `${settingsSnapshot.revision}:${dictionary.revision}`,
    });
    const resource = createAudioResource(Readable.from(audio), { inputType: StreamType.Arbitrary });
    session.player.play(resource);
    await entersState(session.player, AudioPlayerStatus.Playing, 30_000);
    await entersState(session.player, AudioPlayerStatus.Idle, 10 * 60_000);
    logger.info("audio_playback_completed", {
      bot_id: this.deps.botId,
      guild_id: guildId,
      queue_remaining: session.queue.size,
    });
  }
}

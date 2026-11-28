// ==========================================
// 🔊 言ノ葉・紡言（read_aloud_a / read_aloud_b）の起動
// ==========================================
// 🔊 2 Bot は同一コードを別プロセスで起動する（旧構成と同じ）。
// Bot ごとの差分はトークンと識別子だけで、読み上げエンジン・
// 設定・辞書は共有モジュールを使う。intents は旧実装の 33409
// （GUILDS / GUILD_VOICE_STATES / GUILD_MESSAGES /
// MESSAGE_CONTENT。GUILD_MEMBERS は含まない）。

import { Client, Events, GatewayIntentBits, Routes } from "discord.js";
import type { BotId, Config } from "../config.js";
import { openDatabase } from "../db/index.js";
import { logger, setLogService } from "../logger.js";
import { PresenceCycle } from "../presence.js";
import { READ_ALOUD_COMMANDS } from "../readaloud/commands.js";
import { AudioCache, AudioSynthesizer, VoicevoxEngine } from "../readaloud/engine.js";
import { registerReadAloudEvents } from "../readaloud/events.js";
import { ReadAloudVoiceService } from "../readaloud/service.js";

// 🔊 読み上げ Bot の識別子（a / b のどちらか）。
export type ReadAloudBotId = Extract<BotId, "read_aloud_a" | "read_aloud_b">;

// 🔊 読み上げ Bot を起動する。トークンは呼び出し側で確認済みの前提。
export async function startReadAloudBot(config: Config, botId: ReadAloudBotId): Promise<Client> {
  setLogService(botId);
  const store = openDatabase({ path: config.dbPath });
  const synthesizer = new AudioSynthesizer(
    new VoicevoxEngine({ baseUrl: config.voicevoxBaseUrl }),
    new AudioCache({
      dir: config.audioCacheDir,
      maxBytes: config.audioCacheMaxMb * 1024 * 1024,
      ttlMs: config.audioCacheTtlHours * 60 * 60 * 1000,
    }),
  );
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      // 📌 特権 intent: 自動読み上げに必要な本文アクセス（旧実装と同じ）。
      GatewayIntentBits.MessageContent,
    ],
  });
  const service = new ReadAloudVoiceService({ botId, store, synthesizer });
  registerReadAloudEvents({ botId, client, service });

  // 🎮 プレゼンス・サイクル（DESIGN §3.2。星燈と同じ共有モジュール）
  const presence = new PresenceCycle({
    displayName: config.bots[botId].displayName,
    watching: config.bots[botId].watching,
    send: (activity) => {
      client.user?.setActivity(activity.name, { type: activity.type });
    },
  });
  client.on(Events.ShardReady, () => presence.markReady());
  client.on(Events.ShardResume, () => presence.markResumed());
  client.on(Events.ShardDisconnect, () => presence.markDisconnected());

  client.once(Events.ClientReady, (readyClient) => {
    logger.info("bot_ready", { bot_id: botId, user: readyClient.user.tag });
    // 💬 コマンド定義をまとめて登録する（星燈と同じ運用）。
    void (async () => {
      try {
        await readyClient.rest.put(Routes.applicationCommands(readyClient.application.id), {
          body: READ_ALOUD_COMMANDS,
        });
        logger.info("application_commands_synced", { bot_id: botId, count: READ_ALOUD_COMMANDS.length });
      } catch (error) {
        logger.error("command_registration_failed", {
          bot_id: botId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  await client.login(config.bots[botId].token ?? undefined);
  return client;
}

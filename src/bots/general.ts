// ==========================================
// 🤖 星燈（general）の起動
// ==========================================
// 🤖 discord.js で直接 Discord へ接続する（旧構成の Gateway 集約は
// 廃止）。起動時にコマンド定義をまとめて登録し、イベント処理は
// seitou/events.ts へ委ねる。

import { Client, Events, GatewayIntentBits, Routes } from "discord.js";
import { logger, setLogService } from "../logger.js";
import { openDatabase } from "../db/index.js";
import type { Config } from "../config.js";
import { StarSettings } from "../seitou/settings.js";
import { SeitouState } from "../seitou/state.js";
import { registerSeitouEvents } from "../seitou/events.js";
import { SEITOU_COMMANDS } from "../seitou/commands.js";
import type { SeitouDeps } from "../seitou/deps.js";
import { errorMessage } from "../seitou/shared.js";

// 🤖 星燈を起動する。トークンは呼び出し側で確認済みの前提。
export async function startGeneralBot(config: Config): Promise<Client> {
  setLogService("general");
  const store = openDatabase({ path: config.dbPath });
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // 📌 特権 intent 2種（旧実装と同じ）: メンバー参加・自動ロール用と、
      // メッセージ報酬に必要な本文アクセス。
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  const deps: SeitouDeps = {
    store,
    settings: new StarSettings(store),
    state: new SeitouState(),
    client,
    llamaBaseUrl: config.llamaBaseUrl,
  };
  registerSeitouEvents(deps);

  client.once(Events.ClientReady, (readyClient) => {
    logger.info("bot_ready", { bot_id: "general", user: readyClient.user.tag });
    // 💬 コマンド定義をまとめて登録する（内容が同じなら Discord 側で
    // 実質 no-op。再登録は定義変更時の反映も兼ねる）。
    void (async () => {
      try {
        await readyClient.rest.put(Routes.applicationCommands(readyClient.application.id), {
          body: SEITOU_COMMANDS,
        });
        logger.info("application_commands_synced", { bot_id: "general", count: SEITOU_COMMANDS.length });
      } catch (error) {
        logger.error("command_registration_failed", { bot_id: "general", error: errorMessage(error) });
      }
    })();
  });

  await client.login(config.bots.general.token ?? undefined);
  return client;
}

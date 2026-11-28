// ==========================================
// 📚 p1228 エントリポイント
// ==========================================
// 📚 1コードベースから3 Bot（星燈 / 言ノ葉 / 紡言）を起動する入口。
// 起動引数で Bot を選ぶ（無指定または "all" で全 Bot）。
//
//   node dist/src/index.js              → 全 Bot
//   node dist/src/index.js general      → 星燈のみ
//   node dist/src/index.js read_aloud_a → 言ノ葉のみ
//   node dist/src/index.js read_aloud_b → 紡言のみ
//
// 📌 星燈は Phase 2 で実装済み（コマンド群＋イベント処理）。
// 言ノ葉・紡言は Phase 3 で実装する。トークン未設定の Bot は、
// その旨を明確に表示して正常終了する（土台フェーズの方針）。

import { loadConfig, missingTokenBots, selectBotIds, type BotId } from "./config.js";
import { startGeneralBot } from "./bots/general.js";
import { logger } from "./logger.js";

const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);

// ------------------------------------------
// 📚 起動処理
// ------------------------------------------
async function main(): Promise<void> {
  const config = loadConfig();

  // 📌 起動対象の決定（未知の指定は使い方を出して異常終了）
  let targets: BotId[];
  try {
    targets = selectBotIds(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  // 🔑 トークン未設定の Bot は明確に知らせて対象から外す
  const missing = missingTokenBots(config, targets);
  for (const bot of missing) {
    log(
      `${bot.displayName}（${bot.id}）: 環境変数 ${bot.tokenEnvName} が設定されていないため起動しません`,
    );
  }
  const runnable = targets.filter((id) => config.bots[id].token !== null);

  if (runnable.length === 0) {
    log("起動できる Bot がありません。.env を確認してください（.env.example 参照）");
    return;
  }

  for (const id of runnable) {
    const bot = config.bots[id];
    if (id === "general") {
      // 🤖 星燈: Phase 2 で実装済み。
      await startGeneralBot(config);
    } else {
      // 🚧 言ノ葉・紡言の本体は Phase 3 で実装する。
      log(`${bot.displayName}（${bot.id}）: トークンを確認しました（本体は未実装フェーズです）`);
      logger.info("bot_not_implemented_yet", { bot_id: bot.id });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

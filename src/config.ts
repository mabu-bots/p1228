// ==========================================
// 📌 設定の読み込み（環境変数）
// ==========================================
// 📌 環境変数からの設定読み込み。
// 3 Bot 分のトークンと共有設定を型付きで読む。
// 実トークンは .env（リポジトリ外）で管理し、ここでは読むだけにする。
// トークン未設定は例外にせず null として返し、起動側で
// 「未設定のまま正常終了」できるようにする（土台フェーズの方針）。

// ------------------------------------------
// 🤖 Bot の定義
// ------------------------------------------

// 📌 Bot の識別子。1コードベースから3 Bot を起動するための区分。
export type BotId = "general" | "read_aloud_a" | "read_aloud_b";

// 📌 全 Bot の一覧（起動順）。
export const BOT_IDS: readonly BotId[] = ["general", "read_aloud_a", "read_aloud_b"] as const;

export interface BotConfig {
  // 📌 Bot の識別子
  id: BotId;
  // 📌 表示名（星燈 / 言ノ葉 / 紡言）
  displayName: string;
  // 🎮 プレゼンスのパターンAで使う watching 文（DESIGN §3.2。
  // 旧実装では gateway.yaml の watching で Bot ごとに設定していた）
  watching: string;
  // 🔑 Discord の Bot トークン（未設定なら null）
  token: string | null;
  // 📌 トークンを読む環境変数名（エラーメッセージ用）
  tokenEnvName: string;
}

export interface Config {
  // 🤖 Bot ごとの設定
  bots: Record<BotId, BotConfig>;
  // 📦 SQLite データベースのファイルパス（既存 DB をそのまま読む）
  dbPath: string;
  // 🎙️ VOICEVOX ENGINE 互換 API のベース URL（読み上げ用）
  voicevoxBaseUrl: string;
  // 🎙️ 音声キャッシュの保存先ディレクトリ
  audioCacheDir: string;
  // 🔢 音声キャッシュの上限サイズ（MB）
  audioCacheMaxMb: number;
  // 🕐 音声キャッシュの保持時間（時間）
  audioCacheTtlHours: number;
  // 🧠 llama-server（OpenAI 互換 API）のベース URL（/ai 用）
  llamaBaseUrl: string;
  // 📡 ストレージ監視などのアラート用 Webhook URL（任意）
  alertWebhookUrl: string | null;
}

// ------------------------------------------
// 📌 読み込みヘルパー
// ------------------------------------------

function optional(env: NodeJS.ProcessEnv, name: string): string | null {
  const v = env[name]?.trim();
  return v ? v : null;
}

function withDefault(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return optional(env, name) ?? fallback;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = optional(env, name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`環境変数 ${name} は正の整数で指定してください（現在値: ${raw}）`);
  }
  return n;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// ------------------------------------------
// 📌 設定の読み込み
// ------------------------------------------
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    bots: {
      general: {
        id: "general",
        displayName: "星燈",
        watching: "サーバーを見守り中",
        token: optional(env, "P1228_GENERAL_TOKEN"),
        tokenEnvName: "P1228_GENERAL_TOKEN",
      },
      read_aloud_a: {
        id: "read_aloud_a",
        displayName: "言ノ葉",
        watching: "言葉を紡ぎ中",
        token: optional(env, "P1228_READ_ALOUD_A_TOKEN"),
        tokenEnvName: "P1228_READ_ALOUD_A_TOKEN",
      },
      read_aloud_b: {
        id: "read_aloud_b",
        displayName: "紡言",
        watching: "声をお届け中",
        token: optional(env, "P1228_READ_ALOUD_B_TOKEN"),
        tokenEnvName: "P1228_READ_ALOUD_B_TOKEN",
      },
    },
    dbPath: withDefault(env, "P1228_DB_PATH", "data/p1228.sqlite3"),
    voicevoxBaseUrl: stripTrailingSlash(
      withDefault(env, "VOICEVOX_BASE_URL", "http://127.0.0.1:50021"),
    ),
    audioCacheDir: withDefault(env, "P1228_AUDIO_CACHE_DIR", "data/audio-cache"),
    audioCacheMaxMb: positiveInt(env, "P1228_AUDIO_CACHE_MAX_MB", 512),
    audioCacheTtlHours: positiveInt(env, "P1228_AUDIO_CACHE_TTL_HOURS", 24),
    llamaBaseUrl: stripTrailingSlash(withDefault(env, "LLAMA_BASE_URL", "http://127.0.0.1:8080")),
    alertWebhookUrl: optional(env, "P1228_ALERT_WEBHOOK_URL"),
  };
}

// ------------------------------------------
// 📌 起動対象の解決
// ------------------------------------------

// 📌 起動引数から Bot を選ぶ。"all" または無指定なら全 Bot。
// 未知の値が来たら例外にして、起動側で使い方を表示させる。
export function selectBotIds(argv: readonly string[]): BotId[] {
  const arg = argv[0]?.trim().toLowerCase();
  if (arg === undefined || arg === "" || arg === "all") return [...BOT_IDS];
  if ((BOT_IDS as readonly string[]).includes(arg)) return [arg as BotId];
  throw new Error(
    `不明な Bot 指定です: ${argv[0]}（指定可能: ${BOT_IDS.join(" / ")} / all）`,
  );
}

// 🔑 トークン未設定の Bot だけを取り出す（起動前の確認用）。
export function missingTokenBots(config: Config, ids: readonly BotId[]): BotConfig[] {
  return ids.map((id) => config.bots[id]).filter((bot) => bot.token === null);
}

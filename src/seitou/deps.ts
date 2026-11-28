// ==========================================
// 🧩 星燈の依存一式（ハンドラへ渡す束）
// ==========================================
import type { Client } from "discord.js";
import type { Store } from "../db/index.js";
import type { StarSettings } from "./settings.js";
import type { SeitouState } from "./state.js";

export interface SeitouDeps {
  // 💾 DB 層（Phase 1 の Store）
  store: Store;
  // ⚙️ ギルド設定の読み書き
  settings: StarSettings;
  // 🗂️ インメモリのスナップショット
  state: SeitouState;
  // 🤖 discord.js のクライアント（星燈）
  client: Client;
  // 🧠 llama-server のベース URL（/ai 用。config から）
  llamaBaseUrl: string;
}

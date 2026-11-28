// ==========================================
// ⚙️ 星燈のギルド設定（guild_feature_settings）
// ==========================================
// ⚙️ 旧実装では Gateway の Shared Data API 経由で
// guild_feature_settings（キー → JSON）に読み書きしていた。
// 再実装では Phase 1 の DB 層を直接使う。
//
// 📌 旧実装の「無効化」は JSON の null を保存する方式だった。
// 再実装ではキーの削除で表すが、読み取りでは null（旧実装が書いた
// 行を含む）を「未設定」として扱い、どちらの形式でも同じ意味になる。

import type { Store } from "../db/index.js";

// ⚙️ パース済みの設定一式（キー → 値）。値は JSON パース後の値で、
// 未設定または null のキーは呼び出し側の fallback で扱う。
export type StarSettingsMap = Map<string, unknown>;

export class StarSettings {
  constructor(private readonly store: Store) {}

  // ⚙️ ギルドの全設定をパースして返す。
  getAll(guildId: string): StarSettingsMap {
    const result: StarSettingsMap = new Map();
    for (const [key, raw] of this.store.getGuildFeatureSettings(guildId)) {
      try {
        result.set(key, JSON.parse(raw) as unknown);
      } catch {
        // 💾 旧実装の書き込みは JSON 妥当性が保証されているため通常は
        // 起きない。壊れた値は未設定として読み飛ばす。
      }
    }
    return result;
  }

  // ⚙️ 1件取得する。未設定・null・型が合わない場合は fallback を返す。
  get<T>(guildId: string, key: string, fallback: T): T {
    return getSetting(this.getAll(guildId), key, fallback);
  }

  // ⚙️ 1件保存する。null / undefined は「無効化」としてキーを削除する。
  set(guildId: string, key: string, value: unknown): void {
    if (value === null || value === undefined) {
      this.store.deleteGuildFeatureSetting(guildId, key);
      return;
    }
    this.store.setGuildFeatureSetting(guildId, key, JSON.stringify(value));
  }
}

// ⚙️ パース済み設定からキーを引く（旧 setting() ヘルパー相当）。
// null は未設定として扱う。
export function getSetting<T>(settings: StarSettingsMap, key: string, fallback: T): T {
  const value = settings.get(key);
  return value === undefined || value === null ? fallback : (value as T);
}

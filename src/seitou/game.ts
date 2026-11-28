// ==========================================
// 🎮 ゲーム設定（ポイント・抽選のルール）
// ==========================================
// 🎮 旧実装（star-shared.ts の gameDefaults）の移植。Discord
// 非依存の純粋ロジック。設定は設定キー `game` に JSON で保存され、
// Guild ごとに初期値を上書きできる。

import { getSetting, type StarSettingsMap } from "./settings.js";

export interface GameConfig {
  points_per_message: number;
  cooldown_seconds: number;
  daily_limit: number;
  lottery_cost: number;
  lottery_prize: number;
  lottery_chance: number;
}

// 🎮 初期値（DESIGN §3.1: 報酬 1pt/件・60秒クールダウン・UTC 日次
// 上限50pt、抽選は参加費10pt・当選確率20%・当選時+50pt）。
export const GAME_DEFAULTS: GameConfig = {
  points_per_message: 1,
  cooldown_seconds: 60,
  daily_limit: 50,
  lottery_cost: 10,
  lottery_prize: 50,
  lottery_chance: 20,
};

export const GAME_CONFIG_KEYS = Object.keys(GAME_DEFAULTS) as (keyof GameConfig)[];

// 🎮 保存済み設定を初期値へ重ねて実効設定を作る。数値でない値は
// 初期値のままにする。
export function resolveGameConfig(raw: unknown): GameConfig {
  const resolved = { ...GAME_DEFAULTS };
  if (raw !== null && typeof raw === "object") {
    const stored = raw as Record<string, unknown>;
    for (const key of GAME_CONFIG_KEYS) {
      const value = stored[key];
      if (typeof value === "number" && Number.isFinite(value)) resolved[key] = value;
    }
  }
  return resolved;
}

// 🎮 設定一式から実効ゲーム設定を引く。
export function gameConfigOf(settings: StarSettingsMap): GameConfig {
  return resolveGameConfig(getSetting<unknown>(settings, "game", null));
}

// 🎮 /game-config の結果文（旧実装の文面どおり）。
export function formatGameConfigSummary(config: GameConfig): string {
  return `ゲーム設定を更新しました。メッセージ獲得 ${config.points_per_message}pt / クールダウン ${config.cooldown_seconds}秒 / 日上限 ${config.daily_limit}pt / 抽選 ${config.lottery_cost}pt、当選確率 ${config.lottery_chance}%、追加報酬 ${config.lottery_prize}pt`;
}

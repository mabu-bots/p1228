// ==========================================
// 🎭 星燈の自動ロール設定（ユーザー用／Bot用）
// ==========================================
// 🎭 旧実装（star-autorole.ts）の移植。Discord 非依存の純粋ロジック。
//
// 📌 保存形式（設定キー `autorole`）:
//   { user_role_id?: string, bot_role_id?: string }
// 旧形式 { role_id: string } はユーザー用として読み替える（後方互換）。
// Bot には旧形式を適用しない: 旧設定は通常ユーザー向けに意図された
// もので、Bot にまで同じロールが付くのは想定外のため。

import { getSetting, type StarSettingsMap } from "./settings.js";

export interface AutoRoleSettings {
  user_role_id?: string;
  bot_role_id?: string;
  // 📌 旧形式（単一ロール）。読み替え専用で、新規保存では書かない。
  role_id?: string;
}

// 🎭 保存値を正規形（ユーザー用／Bot用の分離形）へ寄せる。
export function normalizeAutoRole(
  raw: AutoRoleSettings | null | undefined,
): { user_role_id?: string; bot_role_id?: string } {
  if (!raw) return {};
  const user = raw.user_role_id || raw.role_id || undefined;
  const bot = raw.bot_role_id || undefined;
  return {
    ...(user ? { user_role_id: user } : {}),
    ...(bot ? { bot_role_id: bot } : {}),
  };
}

// 🎭 参加者（ユーザーか Bot か）に応じて付与すべきロールIDを返す。
// 未設定なら空文字。
export function resolveAutoRoleId(settings: StarSettingsMap, isBot: boolean): string {
  const normalized = normalizeAutoRole(getSetting<AutoRoleSettings | null>(settings, "autorole", null));
  return (isBot ? normalized.bot_role_id : normalized.user_role_id) ?? "";
}

// 🎭 現在の設定を表示用文面にする。
export function formatAutoRoleSettings(settings: StarSettingsMap): string {
  const normalized = normalizeAutoRole(getSetting<AutoRoleSettings | null>(settings, "autorole", null));
  const user = normalized.user_role_id ? `<@&${normalized.user_role_id}>` : "未設定";
  const bot = normalized.bot_role_id ? `<@&${normalized.bot_role_id}>` : "未設定";
  return `ユーザー用: ${user} / Bot用: ${bot}`;
}

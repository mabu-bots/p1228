// ==========================================
// 🔊 星燈のVCログ送信先解決
// ==========================================
// 🔊 旧実装（star-voice-log.ts）の移植。Discord 非依存の純粋ロジック。

import { getSetting, type StarSettingsMap } from "./settings.js";

// ------------------------------------------
// 🔊 種別から設定キーへの対応
// ------------------------------------------
// 📌 /logs の種別から設定キーへの対応。対象IDが必要な種別で
// target_id が無い場合は空文字を返し、呼び出し側でエラーにする。
export function voiceLogSettingKey(eventType: string, targetId: string): string {
  switch (eventType) {
    case "voice":
      return "voice";
    case "voice_join":
      return "voice.join";
    case "voice_leave":
      return "voice.leave";
    case "voice_category":
      return targetId ? `voice.category.${targetId}` : "";
    case "voice_category_join":
      return targetId ? `voice.category.${targetId}.join` : "";
    case "voice_category_leave":
      return targetId ? `voice.category.${targetId}.leave` : "";
    case "voice_channel":
      return targetId ? `voice.channel.${targetId}` : "";
    default:
      return eventType;
  }
}

export type VoiceLogKind = "join" | "leave" | "move";

// 🔊 VCログの送信先を解決する。無ければ空文字。
// ⬆️ 優先順位: チャンネル別（入退室別→共通）→ カテゴリー別（入退室別
// →共通）→ 全体（入退室別→共通）。夜凪のようにゲームカテゴリーごと
// に入室用と退出用のログチャンネルが分かれている構成に対応する。
export function resolveVoiceLogChannel(
  settings: StarSettingsMap,
  channelId: string,
  categoryId: string,
  kind?: VoiceLogKind,
): string {
  const candidates: string[] = [];
  if (kind) candidates.push(`log.voice.channel.${channelId}.${kind}`);
  candidates.push(`log.voice.channel.${channelId}`);
  if (categoryId) {
    if (kind) candidates.push(`log.voice.category.${categoryId}.${kind}`);
    candidates.push(`log.voice.category.${categoryId}`);
  }
  if (kind) candidates.push(`log.voice.${kind}`);
  candidates.push("log.voice");
  for (const key of candidates) {
    const value = getSetting<string>(settings, key, "");
    if (value) return value;
  }
  return "";
}

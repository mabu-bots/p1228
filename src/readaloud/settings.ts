// ==========================================
// ⚙️ 読み上げ設定の解決（Global → Guild → User）
// ==========================================
// ⚙️ 読み上げ設定は read_aloud_settings にスコープ別に保存され、
// 適用時は Global → Guild → User の順に重ねる（旧 Worker の
// getSettings と同じ意味）。保存済み（revision > 0）のスコープだけが
// 既定値を上書きし、合成 revision は音声キャッシュのキーに使う。
// DB への依存は SettingsSnapshotSource インターフェースに閉じ、
// このモジュール自体はテスト可能な純粋ロジックにする。

// ------------------------------------------
// 🔊 設定の型
// ------------------------------------------

export interface ReadAloudSettings {
  // 🔊 読み上げの有効 / 無効
  enabled: boolean;
  // 🔊 話速（0.5〜2.0）
  speed: number;
  // 🔊 音量（0.0〜2.0）
  volume: number;
  // 🔊 VOICEVOX の話者 ID
  speaker_id: number;
}

// 🔊 未保存時の既定設定（旧実装の defaults と同じ値）。
export const DEFAULT_READ_ALOUD_SETTINGS: ReadAloudSettings = {
  enabled: false,
  speed: 1.0,
  volume: 1.0,
  speaker_id: 1,
};

// 🔊 設定スナップショットの供給元（Store が構造的に満たす）。
export interface SettingsSnapshotSource {
  getReadAloudSettings(
    scope: string,
    scopeId: string,
  ): { settingsJson: string; revision: number };
}

export interface ResolvedReadAloudSettings {
  // 🔊 合成済みの設定
  settings: ReadAloudSettings;
  // 🔊 スコープ別 revision を ":" で連結した文字列（キャッシュキー用）
  revision: string;
}

// ------------------------------------------
// ⚙️ 設定の解決
// ------------------------------------------

// ⚙️ 保存済み JSON を部分設定として読む。保存時に検証済みだが、
// 手編集や旧データに備えて型の合う項目だけを取り込む。
function parsePartialSettings(settingsJson: string): Partial<ReadAloudSettings> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(settingsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
  const partial: Partial<ReadAloudSettings> = {};
  if (typeof parsed.enabled === "boolean") partial.enabled = parsed.enabled;
  if (typeof parsed.speed === "number" && Number.isFinite(parsed.speed)) partial.speed = parsed.speed;
  if (typeof parsed.volume === "number" && Number.isFinite(parsed.volume)) {
    partial.volume = parsed.volume;
  }
  if (typeof parsed.speaker_id === "number" && Number.isInteger(parsed.speaker_id)) {
    partial.speaker_id = parsed.speaker_id;
  }
  return partial;
}

// ⚙️ Global → Guild → User の順に設定を合成する。
// revision が 0 のスコープは「未保存」として既定値のままにする
// （旧実装の `snapshot.revision > 0` 判定と同じ）。
export function resolveReadAloudSettings(
  source: SettingsSnapshotSource,
  guildId: string,
  userId?: string,
): ResolvedReadAloudSettings {
  const scopes: Array<{ scope: string; scopeId: string }> = [
    { scope: "global", scopeId: "global" },
    { scope: "guild", scopeId: guildId },
    ...(userId ? [{ scope: "user", scopeId: userId }] : []),
  ];
  let resolved: ReadAloudSettings = { ...DEFAULT_READ_ALOUD_SETTINGS };
  const revisions: number[] = [];
  for (const { scope, scopeId } of scopes) {
    const snapshot = source.getReadAloudSettings(scope, scopeId);
    revisions.push(snapshot.revision);
    if (snapshot.revision > 0) {
      resolved = { ...resolved, ...parsePartialSettings(snapshot.settingsJson) };
    }
  }
  return { settings: resolved, revision: revisions.join(":") };
}

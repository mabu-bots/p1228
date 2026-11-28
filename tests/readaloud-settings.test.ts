// ==========================================
// 🧪 読み上げ設定の解決のテスト
// ==========================================
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_READ_ALOUD_SETTINGS,
  resolveReadAloudSettings,
  type SettingsSnapshotSource,
} from "../src/readaloud/settings.js";

const DEFAULT_JSON = `{"enabled":false,"speed":1.0,"volume":1.0,"speaker_id":1}`;

function fakeSource(
  rows: Record<string, { settingsJson: string; revision: number }>,
): SettingsSnapshotSource {
  return {
    getReadAloudSettings(scope: string, scopeId: string) {
      return rows[`${scope}:${scopeId}`] ?? { settingsJson: DEFAULT_JSON, revision: 0 };
    },
  };
}

test("all scopes unset: defaults apply and revision is all zeros", () => {
  const source = fakeSource({});
  const withoutUser = resolveReadAloudSettings(source, "g1");
  assert.deepEqual(withoutUser.settings, DEFAULT_READ_ALOUD_SETTINGS);
  assert.equal(withoutUser.revision, "0:0");
  const withUser = resolveReadAloudSettings(source, "g1", "u1");
  assert.equal(withUser.revision, "0:0:0");
});

test("saved guild settings override global; user overrides guild", () => {
  const source = fakeSource({
    "global:global": {
      settingsJson: `{"enabled":true,"speed":1.5,"volume":0.5,"speaker_id":3}`,
      revision: 2,
    },
    "guild:g1": {
      settingsJson: `{"enabled":true,"speed":0.8,"volume":0.5,"speaker_id":3}`,
      revision: 1,
    },
    "user:u1": {
      settingsJson: `{"enabled":false,"speed":0.8,"volume":2.0,"speaker_id":7}`,
      revision: 4,
    },
  });
  const guildOnly = resolveReadAloudSettings(source, "g1");
  assert.deepEqual(guildOnly.settings, { enabled: true, speed: 0.8, volume: 0.5, speaker_id: 3 });
  assert.equal(guildOnly.revision, "2:1");
  const withUser = resolveReadAloudSettings(source, "g1", "u1");
  assert.deepEqual(withUser.settings, { enabled: false, speed: 0.8, volume: 2.0, speaker_id: 7 });
  assert.equal(withUser.revision, "2:1:4");
});

test("revision 0 scopes never override, even with non-default JSON", () => {
  const source = fakeSource({
    "guild:g1": {
      settingsJson: `{"enabled":true,"speed":2.0,"volume":2.0,"speaker_id":9}`,
      revision: 0,
    },
  });
  const resolved = resolveReadAloudSettings(source, "g1");
  assert.deepEqual(resolved.settings, DEFAULT_READ_ALOUD_SETTINGS);
});

test("broken JSON in a saved scope is ignored field by field", () => {
  const source = fakeSource({
    "guild:g1": { settingsJson: `{"speed":"fast","volume":1.2}`, revision: 1 },
  });
  const resolved = resolveReadAloudSettings(source, "g1");
  assert.equal(resolved.settings.speed, 1.0);
  assert.equal(resolved.settings.volume, 1.2);
});

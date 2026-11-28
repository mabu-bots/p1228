// ==========================================
// 🧪 星燈グループ (c) VC自動生成のテスト
// ==========================================
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempVoiceChannelName } from "../src/seitou/vc-auto.js";

test("tempVoiceChannelName: 「<名前>のVC」を作り、空白を整える", () => {
  assert.equal(tempVoiceChannelName("たろう"), "たろうのVC");
  assert.equal(tempVoiceChannelName("  たろ う  "), "たろ うのVC");
  assert.equal(tempVoiceChannelName(""), "専用VC");
  assert.equal(tempVoiceChannelName("   "), "専用VC");
});

test("tempVoiceChannelName: 名前は80字で切り詰める", () => {
  const name = tempVoiceChannelName("あ".repeat(100));
  assert.equal(name, `${"あ".repeat(80)}のVC`);
});

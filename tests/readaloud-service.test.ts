// ==========================================
// 🧪 読み上げサービスのテスト（未接続時の振る舞い）
// ==========================================
// 🔊 実接続は Discord が必要なため、ここではセッションが無い
// 状態での判定・例外だけを検証する（実再生の確認は DESIGN §6-3
// の未決定事項として残る）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/db/index.js";
import type { AudioSynthesizer } from "../src/readaloud/engine.js";
import { ReadAloudVoiceService } from "../src/readaloud/service.js";

function makeService(): { service: ReadAloudVoiceService; synthesized: number } {
  const store = openDatabase({ path: ":memory:" });
  const counter = { synthesized: 0 };
  const synthesizer = {
    synthesize: async () => {
      counter.synthesized += 1;
      return Buffer.alloc(0);
    },
  } as unknown as AudioSynthesizer;
  const service = new ReadAloudVoiceService({ botId: "read_aloud_a", store, synthesizer });
  return { service, synthesized: counter.synthesized };
}

test("speak without a session throws the parity error", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.speak("g1", "テスト"),
    /BOT is not connected to a voice channel\. Use \/join first\./,
  );
});

test("maybeReadMessage without a session is a no-op", async () => {
  const { service, synthesized } = makeService();
  await service.maybeReadMessage("g1", "u1", "こんにちは");
  await service.maybeReadMessage("", "u1", "こんにちは");
  await service.maybeReadMessage("g1", "u1", "   ");
  assert.equal(synthesized, 0);
});

test("leave and leaveIfAlone without a session are no-ops", async () => {
  const { service } = makeService();
  await service.leave("g1");
  await service.leaveIfAlone("g1", 0);
  assert.equal(service.isConnected("g1"), false);
  assert.equal(service.sessionChannelId("g1"), null);
});

test("join validates guild and channel ids", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.join("", "c1", (() => ({})) as never),
    /guild_id and channel_id are required/,
  );
});

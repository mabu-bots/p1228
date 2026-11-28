// ==========================================
// 🧪 読み上げコマンド定義のテスト
// ==========================================
// 💬 旧実装（workers/src/sync-commands.ts）の定義との一致を確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { READ_ALOUD_COMMANDS } from "../src/readaloud/commands.js";

type CommandJson = {
  name: string;
  description?: string;
  options?: Array<Record<string, unknown>>;
};

const commands = READ_ALOUD_COMMANDS as unknown as CommandJson[];

test("read-aloud commands match the legacy definitions", () => {
  assert.deepEqual(
    commands.map((command) => command.name),
    ["join", "leave", "say"],
  );
  const join = commands[0];
  assert.equal(join?.description, "指定したボイスチャンネルに接続します");
  assert.equal(join?.options?.length, 1);
  const channel = join?.options?.[0];
  assert.equal(channel?.["name"], "channel");
  assert.equal(channel?.["description"], "接続先チャンネル");
  assert.equal(channel?.["type"], 7);
  assert.equal(channel?.["required"], true);
  assert.deepEqual(channel?.["channel_types"], [2, 13]);

  const leave = commands[1];
  assert.equal(leave?.description, "ボイスチャンネルから退出します");
  assert.deepEqual(leave?.options ?? [], []);

  const say = commands[2];
  assert.equal(say?.description, "指定した文章を読み上げます");
  const text = say?.options?.[0];
  assert.equal(text?.["name"], "text");
  assert.equal(text?.["description"], "読み上げる文章");
  assert.equal(text?.["type"], 3);
  assert.equal(text?.["required"], true);
  assert.equal(text?.["max_length"], 1000);
});

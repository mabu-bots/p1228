// ==========================================
// 🧪 星燈のコマンド定義のテスト
// ==========================================
// 🧪 登録用 JSON が旧定義（18件・サブコマンド25件）と一致することを、
// 件数と代表オプションで固定する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { SEITOU_COMMANDS } from "../src/seitou/commands.js";

interface OptionShape {
  name: string;
  type: number;
  required?: boolean;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  channel_types?: number[];
  choices?: { name: string; value: string }[];
  options?: OptionShape[];
}

interface CommandShape {
  name: string;
  description: string;
  options?: OptionShape[];
}

const commands = SEITOU_COMMANDS as unknown as CommandShape[];
const byName = new Map(commands.map((command) => [command.name, command]));

function subcommands(command: CommandShape): OptionShape[] {
  return (command.options ?? []).filter((option) => option.type === 1);
}

test("コマンドは18件で、名前と順序が旧定義と一致する", () => {
  assert.deepEqual(
    commands.map((command) => command.name),
    [
      "ping",
      "welcome",
      "goodbye",
      "autorole",
      "blacklist",
      "logs",
      "sticky",
      "role-panel",
      "game-config",
      "omikuji",
      "points",
      "lottery",
      "shop",
      "buy",
      "vc-auto",
      "ticket",
      "tsukigakure",
      "ai",
    ],
  );
});

test("サブコマンドは合計25件", () => {
  const total = commands.reduce((sum, command) => sum + subcommands(command).length, 0);
  assert.equal(total, 25);
  assert.deepEqual(
    Object.fromEntries(commands.map((command) => [command.name, subcommands(command).map((sub) => sub.name)])),
    {
      ping: [],
      welcome: ["set", "disable"],
      goodbye: ["set", "disable"],
      autorole: ["set", "disable", "show"],
      blacklist: ["add", "remove"],
      logs: ["set", "disable"],
      sticky: ["set", "remove"],
      "role-panel": ["remove", "create"],
      "game-config": [],
      omikuji: [],
      points: [],
      lottery: [],
      shop: ["list", "add"],
      buy: [],
      "vc-auto": ["set", "remove", "list"],
      ticket: ["panel", "close"],
      tsukigakure: ["panel", "room", "vc"],
      ai: [],
    },
  );
});

test("welcome set: チャンネル（テキストのみ）と本文（最大1,000字）が必須", () => {
  const set = subcommands(byName.get("welcome")!).find((sub) => sub.name === "set")!;
  const channel = set.options!.find((option) => option.name === "channel")!;
  assert.equal(channel.type, 7);
  assert.equal(channel.required, true);
  assert.deepEqual(channel.channel_types, [0]);
  const message = set.options!.find((option) => option.name === "message")!;
  assert.equal(message.type, 3);
  assert.equal(message.required, true);
  assert.equal(message.max_length, 1000);
});

test("logs: 種別の選択肢は13件で set / disable 共通", () => {
  for (const subName of ["set", "disable"]) {
    const sub = subcommands(byName.get("logs")!).find((item) => item.name === subName)!;
    const event = sub.options!.find((option) => option.name === "event")!;
    assert.equal(event.choices!.length, 13);
    assert.equal(event.choices![0]!.value, "message_edit");
    assert.equal(event.choices![12]!.value, "voice_channel");
  }
});

test("role-panel create: ロールは role1 のみ必須、ラベルは最大80字", () => {
  const create = subcommands(byName.get("role-panel")!).find((sub) => sub.name === "create")!;
  const role1 = create.options!.find((option) => option.name === "role1")!;
  const role5 = create.options!.find((option) => option.name === "role5")!;
  assert.equal(role1.type, 8);
  assert.equal(role1.required, true);
  assert.equal(role5.required, false);
  const label3 = create.options!.find((option) => option.name === "label3")!;
  assert.equal(label3.max_length, 80);
});

test("game-config: 6オプションの範囲が旧定義どおり", () => {
  const options = byName.get("game-config")!.options!;
  const ranges = Object.fromEntries(options.map((option) => [option.name, [option.min_value, option.max_value]]));
  assert.deepEqual(ranges, {
    points_per_message: [1, 1000],
    cooldown_seconds: [0, 86400],
    daily_limit: [1, 100000],
    lottery_cost: [1, 100000],
    lottery_prize: [0, 1000000],
    lottery_chance: [0, 100],
  });
});

test("vc-auto set: ロビーは音声/ステージ、生成先はカテゴリー", () => {
  const set = subcommands(byName.get("vc-auto")!).find((sub) => sub.name === "set")!;
  const lobby = set.options!.find((option) => option.name === "lobby")!;
  assert.deepEqual(lobby.channel_types, [2, 13]);
  const category = set.options!.find((option) => option.name === "category")!;
  assert.deepEqual(category.channel_types, [4]);
});

test("ticket panel: 記録先フォーラムは任意でフォーラム種別のみ", () => {
  const panel = subcommands(byName.get("ticket")!).find((sub) => sub.name === "panel")!;
  const record = panel.options!.find((option) => option.name === "record_channel")!;
  assert.equal(record.required, false);
  assert.deepEqual(record.channel_types, [15]);
});

test("ai: prompt は必須で最大500字", () => {
  const prompt = byName.get("ai")!.options!.find((option) => option.name === "prompt")!;
  assert.equal(prompt.required, true);
  assert.equal(prompt.max_length, 500);
});

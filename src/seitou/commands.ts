// ==========================================
// 💬 星燈のスラッシュコマンド定義
// ==========================================
// 💬 登録用 JSON の正。旧実装（workers/src/general/star-commands.ts
// ＋ sync-commands.ts の /ping）の定義と、名前・説明・オプション・
// 選択肢・範囲を一致させてある。定義（このファイル）とハンドラ
// （features 配下）を分離し、Bot 起動時にまとめて登録する。

import {
  ChannelType,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

// ------------------------------------------
// 🧰 定義用ヘルパー
// ------------------------------------------

type Sub = SlashCommandSubcommandBuilder;

// ------------------------------------------
// 💬 コマンド定義（星燈固有 17件）
// ------------------------------------------

const welcome = new SlashCommandBuilder()
  .setName("welcome")
  .setDescription("参加時メッセージを設定します")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("set")
      .setDescription("参加時メッセージを設定")
      .addChannelOption((option) =>
        option.setName("channel").setDescription("送信先").setRequired(true).addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("本文 ({user}, {username}, {server} が使用可能)")
          .setRequired(true)
          .setMaxLength(1000),
      ),
  )
  .addSubcommand((sub: Sub) => sub.setName("disable").setDescription("参加時メッセージを無効化"));

const goodbye = new SlashCommandBuilder()
  .setName("goodbye")
  .setDescription("退出時メッセージを設定します")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("set")
      .setDescription("退出時メッセージを設定")
      .addChannelOption((option) =>
        option.setName("channel").setDescription("送信先").setRequired(true).addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("本文 ({user}, {username}, {server} が使用可能)")
          .setRequired(true)
          .setMaxLength(1000),
      ),
  )
  .addSubcommand((sub: Sub) => sub.setName("disable").setDescription("退出時メッセージを無効化"));

const autorole = new SlashCommandBuilder()
  .setName("autorole")
  .setDescription("参加時の自動ロールを設定します（ユーザー用／Bot用）")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("set")
      .setDescription("自動付与するロールを設定（ユーザー用／Bot用のどちらか、または両方を指定）")
      .addRoleOption((option) => option.setName("user_role").setDescription("通常ユーザーに付与するロール"))
      .addRoleOption((option) => option.setName("bot_role").setDescription("Botに付与するロール")),
  )
  .addSubcommand((sub: Sub) =>
    sub
      .setName("disable")
      .setDescription("自動ロールを無効化")
      .addStringOption((option) =>
        option
          .setName("target")
          .setDescription("無効化する対象（未指定はすべて）")
          .addChoices(
            { name: "すべて", value: "all" },
            { name: "ユーザー用のみ", value: "user" },
            { name: "Bot用のみ", value: "bot" },
          ),
      ),
  )
  .addSubcommand((sub: Sub) => sub.setName("show").setDescription("現在の自動ロール設定を表示"));

const blacklist = new SlashCommandBuilder()
  .setName("blacklist")
  .setDescription("自動ロール付与のブラックリストを管理します")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("add")
      .setDescription("ユーザーをブラックリストに追加")
      .addUserOption((option) => option.setName("user").setDescription("対象ユーザー").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("理由").setMaxLength(500)),
  )
  .addSubcommand((sub: Sub) =>
    sub
      .setName("remove")
      .setDescription("ユーザーをブラックリストから削除")
      .addUserOption((option) => option.setName("user").setDescription("対象ユーザー").setRequired(true)),
  );

// 📝 ログ種別の選択肢（set / disable で共用。旧定義と同一）。
const logEventChoices = [
  { name: "メッセージ編集", value: "message_edit" },
  { name: "メッセージ削除", value: "message_delete" },
  { name: "メンバー参加", value: "member_join" },
  { name: "メンバー退出", value: "member_leave" },
  { name: "ロール変更", value: "role_update" },
  { name: "自動ロール拒否", value: "autorole_refused" },
  { name: "VCログ（共通）", value: "voice" },
  { name: "VCログ（全体・入室のみ）", value: "voice_join" },
  { name: "VCログ（全体・退出のみ）", value: "voice_leave" },
  { name: "VCカテゴリー別", value: "voice_category" },
  { name: "VCカテゴリー別（入室）", value: "voice_category_join" },
  { name: "VCカテゴリー別（退出）", value: "voice_category_leave" },
  { name: "VCチャンネル別", value: "voice_channel" },
] as const;

const logs = new SlashCommandBuilder()
  .setName("logs")
  .setDescription("イベントログの送信先を設定します")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("set")
      .setDescription("ログ送信先を設定")
      .addStringOption((option) =>
        option.setName("event").setDescription("ログ種別").setRequired(true).addChoices(...logEventChoices),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("ログ送信先チャンネル")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((option) =>
        option.setName("target_id").setDescription("VCのカテゴリーIDまたはチャンネルID（VC種別の場合）"),
      ),
  )
  .addSubcommand((sub: Sub) =>
    sub
      .setName("disable")
      .setDescription("ログ送信先を解除")
      .addStringOption((option) =>
        option.setName("event").setDescription("ログ種別").setRequired(true).addChoices(...logEventChoices),
      )
      .addStringOption((option) =>
        option.setName("target_id").setDescription("VCのカテゴリーIDまたはチャンネルID（VC種別の場合）"),
      ),
  );

const sticky = new SlashCommandBuilder()
  .setName("sticky")
  .setDescription("チャンネル下部に固定メッセージを表示します")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("set")
      .setDescription("固定メッセージを設定")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("対象チャンネル")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((option) =>
        option.setName("message").setDescription("固定する本文").setRequired(true).setMaxLength(2000),
      ),
  )
  .addSubcommand((sub: Sub) =>
    sub
      .setName("remove")
      .setDescription("固定メッセージを解除")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("対象チャンネル")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      ),
  );

// 📌 旧定義では remove が create より前に並んでいる。その順序も含めて
// 定義を一致させる。
const rolePanel = new SlashCommandBuilder()
  .setName("role-panel")
  .setDescription("ロール付与パネルを投稿します")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("remove")
      .setDescription("投稿済みパネルを削除")
      .addStringOption((option) =>
        option.setName("message_id").setDescription("パネルメッセージのID").setRequired(true).setMaxLength(32),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("パネルのあるチャンネル")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub: Sub) => {
    sub
      .setName("create")
      .setDescription("最大5個のロールボタンを作成")
      .addChannelOption((option) =>
        option.setName("channel").setDescription("投稿先").setRequired(true).addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((option) =>
        option.setName("title").setDescription("パネルの説明").setRequired(true).setMaxLength(500),
      );
    for (let index = 1; index <= 5; index++) {
      sub.addRoleOption((option) =>
        option.setName(`role${index}`).setDescription(`ロール${index}`).setRequired(index === 1),
      );
      sub.addStringOption((option) =>
        option.setName(`label${index}`).setDescription(`ボタン${index}の表示名`).setMaxLength(80),
      );
    }
    return sub;
  });

const gameConfig = new SlashCommandBuilder()
  .setName("game-config")
  .setDescription("ポイント獲得と抽選のルールを設定します")
  .addIntegerOption((option) =>
    option.setName("points_per_message").setDescription("メッセージ1回の獲得ポイント").setMinValue(1).setMaxValue(1000),
  )
  .addIntegerOption((option) =>
    option.setName("cooldown_seconds").setDescription("獲得クールダウン（秒）").setMinValue(0).setMaxValue(86400),
  )
  .addIntegerOption((option) =>
    option.setName("daily_limit").setDescription("1日の獲得上限").setMinValue(1).setMaxValue(100000),
  )
  .addIntegerOption((option) =>
    option.setName("lottery_cost").setDescription("抽選に必要なポイント").setMinValue(1).setMaxValue(100000),
  )
  .addIntegerOption((option) =>
    option
      .setName("lottery_prize")
      .setDescription("当選時の追加ポイント")
      .setMinValue(0)
      .setMaxValue(1000000),
  )
  .addIntegerOption((option) =>
    option.setName("lottery_chance").setDescription("当選確率（%）").setMinValue(0).setMaxValue(100),
  );

const omikuji = new SlashCommandBuilder().setName("omikuji").setDescription("1日1回おみくじを引きます");

const points = new SlashCommandBuilder().setName("points").setDescription("ポイント残高を確認します");

const lottery = new SlashCommandBuilder().setName("lottery").setDescription("ポイントを使って抽選します");

const shop = new SlashCommandBuilder()
  .setName("shop")
  .setDescription("ポイントショップを表示・管理します")
  .addSubcommand((sub: Sub) => sub.setName("list").setDescription("販売中の商品を表示"))
  .addSubcommand((sub: Sub) =>
    sub
      .setName("add")
      .setDescription("ロール商品を登録")
      .addStringOption((option) =>
        option.setName("item_id").setDescription("商品ID（英数字・ハイフン）").setRequired(true).setMaxLength(50),
      )
      .addStringOption((option) => option.setName("name").setDescription("商品名").setRequired(true).setMaxLength(100))
      .addIntegerOption((option) =>
        option.setName("price").setDescription("価格").setRequired(true).setMinValue(1).setMaxValue(1000000),
      )
      .addRoleOption((option) => option.setName("role").setDescription("購入時に付与するロール").setRequired(true)),
  );

const buy = new SlashCommandBuilder()
  .setName("buy")
  .setDescription("ポイントショップの商品を購入します")
  .addStringOption((option) => option.setName("item_id").setDescription("商品ID").setRequired(true).setMaxLength(50));

const vcAuto = new SlashCommandBuilder()
  .setName("vc-auto")
  .setDescription("VC自動生成（ロビー参加で専用VCを作成）を設定します")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("set")
      .setDescription("ロビーVCと生成先カテゴリーを登録")
      .addChannelOption((option) =>
        option
          .setName("lobby")
          .setDescription("ロビーにするボイスチャンネル")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
      )
      .addChannelOption((option) =>
        option
          .setName("category")
          .setDescription("一時VCの生成先カテゴリー")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildCategory),
      ),
  )
  .addSubcommand((sub: Sub) =>
    sub
      .setName("remove")
      .setDescription("ロビーVCの登録を解除")
      .addChannelOption((option) =>
        option
          .setName("lobby")
          .setDescription("解除するロビーVC")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
      ),
  )
  .addSubcommand((sub: Sub) => sub.setName("list").setDescription("登録済みロビーと生成中の一時VCを表示"));

const ticket = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("チケット（個別相談）受付を設定します")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("panel")
      .setDescription("受付パネルを投稿")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("パネルの投稿先")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("category")
          .setDescription("チケットチャンネルの作成先カテゴリー")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildCategory),
      )
      .addRoleOption((option) => option.setName("staff_role").setDescription("対応する運営ロール").setRequired(true))
      .addChannelOption((option) =>
        option
          .setName("record_channel")
          .setDescription("クローズ時の記録先フォーラム（任意）")
          .addChannelTypes(ChannelType.GuildForum),
      ),
  )
  .addSubcommand((sub: Sub) => sub.setName("close").setDescription("このチケットをクローズ（記録して削除）"));

const tsukigakure = new SlashCommandBuilder()
  .setName("tsukigakure")
  .setDescription("月隠れ制度（担当のみが扱う非公開相談）を設定・支援します")
  .addSubcommand((sub: Sub) =>
    sub
      .setName("panel")
      .setDescription("月隠れ相談の受付パネルを投稿")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("パネルの投稿先")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("category")
          .setDescription("相談チャンネルの作成先カテゴリー")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildCategory),
      )
      .addRoleOption((option) =>
        option.setName("staff_role").setDescription("月隠れ担当ロール（このロールだけが相談を閲覧できます）").setRequired(true),
      ),
  )
  .addSubcommand((sub: Sub) =>
    sub
      .setName("room")
      .setDescription("相談者と担当だけが見える限定チャンネルを作成")
      .addUserOption((option) => option.setName("member").setDescription("相談者").setRequired(true)),
  )
  .addSubcommand((sub: Sub) =>
    sub
      .setName("vc")
      .setDescription("特定の相手が接続できない専用VCを作成")
      .addUserOption((option) => option.setName("member").setDescription("相談者").setRequired(true))
      .addUserOption((option) => option.setName("block").setDescription("接続を拒否する相手").setRequired(true)),
  );

const ai = new SlashCommandBuilder()
  .setName("ai")
  .setDescription("ローカルAIに質問します")
  .addStringOption((option) => option.setName("prompt").setDescription("質問・お題").setRequired(true).setMaxLength(500));

const ping = new SlashCommandBuilder().setName("ping").setDescription("星燈の応答状態を確認します");

// ------------------------------------------
// 💬 登録用 JSON（/ping ＋ 星燈固有 17件）
// ------------------------------------------

// 📌 addSubcommand / addXxxOption の連鎖で各ビルダーの型は絞り込まれる
// ため、登録に必要な toJSON だけを持つ型として束ねる。
const builders: { toJSON(): RESTPostAPIApplicationCommandsJSONBody }[] = [
  ping,
  welcome,
  goodbye,
  autorole,
  blacklist,
  logs,
  sticky,
  rolePanel,
  gameConfig,
  omikuji,
  points,
  lottery,
  shop,
  buy,
  vcAuto,
  ticket,
  tsukigakure,
  ai,
];

// 💬 Bot 起動時にまとめて登録するコマンド定義一式。
export const SEITOU_COMMANDS: RESTPostAPIApplicationCommandsJSONBody[] = builders.map((builder) =>
  builder.toJSON(),
);

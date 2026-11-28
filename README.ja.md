# p1228

夜凪鯖で稼働する Discord Bot 3体 — **星燈**、**言ノ葉**、**紡言** — の
リポジトリ。サーバー運営・コミュニティ機能と、独立した読み上げ Bot
2体を提供する。

[English README](README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/mabu-bots/p1228/actions/workflows/ci.yml/badge.svg)](https://github.com/mabu-bots/p1228/actions/workflows/ci.yml)

> **状態: ゼロから作り直し中（再実装進行中）**
> 本リポジトリは p1228 を TypeScript 単一コードベースで新規に
> 作り直しているもの。旧実装（Go Gateway ＋ TypeScript Workers）は
> フェーズごとに置き換える。計画・パリティ仕様・未決定事項は
> [DESIGN.md](DESIGN.md) を参照。バージョンは再実装に伴い
> v0.1.0 から振り直した。

## Bot の役割

| Bot | 役割 |
|---|---|
| 星燈（general） | サーバー機能・管理全般: 参加/退出メッセージ、自動ロール、ブラックリスト、ログ振り分け、Sticky、ロールパネル、ポイント経済（おみくじ・抽選・ロールショップ）、一時 VC 自動生成、チケット、月隠れ、ローカル LLM を使う `/ai` |
| 言ノ葉（read_aloud_a） | 読み上げ Bot（独立 Voice セッション）。VOICEVOX 互換エンジンでテキストチャンネルを読み上げる |
| 紡言（read_aloud_b） | 読み上げ Bot の2体目（同一コード・別プロセス・独立 Voice セッション） |

## 構成

- **TypeScript 単一構成**（Node.js 22 以上、discord.js）。1つの入口
  から3 Bot の任意の組み合わせを起動し、DB 層・プレゼンスサイクル・
  音声まわりは共有モジュール化する。旧構成の Go Gateway ＋ TS
  Workers 分離は廃止し、各 Bot が自分のトークンで Discord へ直接
  接続する。
- **SQLite**（better-sqlite3）。再実装は既存の本番 DB をそのまま
  読む（schema migration 001〜004、アプリケーションテーブル25件）。
  データ変換は行わない。
- **プレゼンスサイクル**: 全 Bot 共通で Playing を分粒度表示し、
  「起動経過時間」と「現在時刻 JST」を1分ごとに交代。位相は壁時計
  の分の偶奇で全 Bot 同期し、境界の200ms 前に先行送信する（旧実装
  の数値仕様をそのまま引き継ぐ）。

受入条件は旧実装との機能パリティ: スラッシュコマンド24件
（星燈18件＝サブコマンド25件、読み上げ各3件）、上記プレゼンス
仕様、既存 DB の内容（ポイント残高・購入状態・設定・辞書）の保持。

## 動作要件

- Node.js 22 以上
- Discord アプリケーション3つ（Bot ごとに1つ）
- 読み上げ用: VOICEVOX ENGINE 互換 HTTP API
- `/ai` 用: llama.cpp llama-server（OpenAI 互換 API）

## セットアップ

```bash
npm ci
cp .env.example .env   # 3 Bot 分のトークンを記入
npm run build
npm start              # 全 Bot。1体だけなら node dist/src/index.js general
```

トークン未設定の Bot は、その旨を表示してスキップし、プロセスは
正常終了する（クラッシュループにしない）。

## 運用

定期処理は Bot 本体とは独立した systemd タイマーで回す（定義と
スクリプトは [deploy/](deploy/README.md)）: SQLite バックアップ
（毎日 03:50 UTC）、ログアーカイブ（毎日 03:20 UTC、90日保持）、
ストレージ監視（10分間隔、通知のみで自動削除しない）。

## 開発手順

家の統一手順に従う: Issue → ブランチ `<type>/<issue#>-<slug>` →
PR（`Closes #<n>`）→ Rebase and merge。詳細は
[CONTRIBUTING.md](CONTRIBUTING.md)。

## ライセンス

MIT — [LICENSE](LICENSE) を参照。

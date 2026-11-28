# deploy — 運用資産（systemd タイマーとスクリプト）

本番（台1 yanagi）の定期処理は、Bot 本体とは独立した systemd
タイマーで回す（旧実装の運用をそのまま引き継ぐ。仕様は DESIGN
§3.4）。Bot 本体の systemd ユニットと配置手順は Phase 5 で整備する。

## タイマー3種

| タイマー | 周期 | 実体スクリプト | 内容 |
|---|---|---|---|
| `p1228-db-backup.timer` | 毎日 03:50 UTC | `p1228-backup-sqlite.sh` | SQLite のオンラインバックアップ（`.backup` 使用。WAL 稼働中の DB を `cp` しない）。完全性確認つき。保持は日次7世代＋週次コピー84日。バックアップ側では event_inbox / event_dead_letters の payload を除去する（`P1228_EVENT_PAYLOAD_BACKUP_POLICY=redact` 必須） |
| `p1228-log-archive.timer` | 毎日 03:20 UTC | `p1228-archive-logs.sh` | journald ログの日次アーカイブ（gzip、完全性検証つき）。保持90日で削除 |
| `p1228-storage-monitor.timer` | 起動3分後＋10分間隔 | `p1228-monitor-storage.sh` | ディスク / inode 使用率の監視。閾値超過時は Webhook 通知のみで、自動削除はしない |

## 配置先（サーバー側）

- ユニット: `deploy/systemd/*` → `/etc/systemd/system/`
- スクリプト: `deploy/scripts/*.sh` → `/usr/local/sbin/p1228-<名前>.sh`
  （ユニット側の `ExecStart` がこのパスを指す）
- 環境ファイル: `/etc/p1228/storage.env`（各 service が
  `EnvironmentFile=-/etc/p1228/storage.env` で任意読み込みする。
  `P1228_DB_PATH` や `P1228_ALERT_WEBHOOK_URL` 等の上書きはここで行う）
- 有効化: `systemctl enable --now p1228-db-backup.timer
  p1228-log-archive.timer p1228-storage-monitor.timer`

## 注意

- `archive-logs.sh` のアーカイブ対象サービス名リストには旧構成の
  ユニット名（`p1228-gateway` 等）が残っている。Phase 5 で Bot 本体
  のユニット名を確定させる際に、新構成の名前に合わせて見直す。
- バックアップ／アーカイブの障害で Bot 本体を止めない（旧実装の
  方針どおり、タイマー側は独立に失敗する）。

#!/usr/bin/env bash
set -Eeuo pipefail

# Local-only SQLite backup. No remote upload: backups stay on local disk
# under BACKUP_DIR (daily) and BACKUP_DIR/weekly (Sunday copies).
# ===== 1. 設定と前提確認 =====
DB="${P1228_DB_PATH:-/var/lib/p1228/database/p1228.db}"
BACKUP_DIR="${P1228_DB_BACKUP_DIR:-/var/backups/p1228/sqlite}"
EVENT_PAYLOAD_BACKUP_POLICY="${P1228_EVENT_PAYLOAD_BACKUP_POLICY:-redact}"
mkdir -p "$BACKUP_DIR"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
command -v sqlite3 >/dev/null
[[ -s "$DB" ]] || {
  echo "SQLite DB not found: $DB" >&2
  exit 1
}
[[ "$EVENT_PAYLOAD_BACKUP_POLICY" == "redact" ]] || {
  echo "P1228_EVENT_PAYLOAD_BACKUP_POLICY must be 'redact'; unredacted event payload backups are disabled" >&2
  exit 1
}

# ===== 2. バックアップ作成とペイロード除去 =====
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_FILE="$BACKUP_DIR/p1228-${STAMP}.db"
MANIFEST="$DB_FILE.json"

# SQLite Online Backup API via sqlite3 .backup; never cp the live WAL database.
sqlite3 "$DB" ".backup '$DB_FILE'"

# Event payloads are deliberately excluded from portable backups. Keeping event
# metadata/status is useful for audit, but replaying an old inbox after restore is
# unsafe and would extend message-content retention to the backup retention period.

# ----- ペイロード除去 -----
sqlite3 "$DB_FILE" <<'SQL'
BEGIN IMMEDIATE;
UPDATE event_inbox
   SET payload_json='{}',
       status='acked',
       lease_until=NULL,
       lease_owner=NULL,
       lease_token=NULL,
       not_before=NULL,
       last_error='payload omitted from backup';
UPDATE event_dead_letters SET payload_json='{}';
COMMIT;
SQL

# ===== 3. 完全性検証とマニフェスト生成 =====
CHECK="$(sqlite3 "$DB_FILE" 'PRAGMA integrity_check;')"
[[ "$CHECK" == "ok" ]] || {
  echo "SQLite integrity_check failed: $CHECK" >&2
  exit 1
}
SIZE="$(stat -c '%s' "$DB_FILE")"
SHA="$(sha256sum "$DB_FILE" | awk '{print $1}')"
python3 - "$MANIFEST" "$STAMP" "$SIZE" "$SHA" <<'PY'
import json, sys
path, stamp, size, sha = sys.argv[1:]
with open(path, "w", encoding="utf-8") as f:
    json.dump({"created_at": stamp, "bytes": int(size), "sha256": sha, "integrity_check": "ok", "event_payloads": "redacted"}, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

# ===== 4. ローカル検証と週次コピー =====
# Verify the local backup against its manifest (re-read size and SHA-256).
verify_local() {
  local file="$1" manifest="$2" expected_size expected_sha actual_size actual_sha
  expected_size="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bytes"])' "$manifest")"
  expected_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$manifest")"
  actual_size="$(stat -c '%s' "$file")"
  actual_sha="$(sha256sum "$file" | awk '{print $1}')"
  [[ "$actual_size" == "$expected_size" && "$actual_sha" == "$expected_sha" ]] || {
    echo "Local verification failed for $file" >&2
    return 1
  }
}
verify_local "$DB_FILE" "$MANIFEST"

# Duplicate a verified Sunday backup into the local weekly prefix and prune
# weekly copies older than 84 days (12 weeks).
if [[ "$(date -u +%u)" == "7" ]]; then
  WEEK_DIR="$BACKUP_DIR/weekly/$(date -u +%G/%V)"
  mkdir -p "$WEEK_DIR"
  cp -- "$DB_FILE" "$WEEK_DIR/$(basename "$DB_FILE")"
  cp -- "$MANIFEST" "$WEEK_DIR/$(basename "$MANIFEST")"
  verify_local "$WEEK_DIR/$(basename "$DB_FILE")" "$WEEK_DIR/$(basename "$MANIFEST")"
  find "$BACKUP_DIR/weekly" -mindepth 2 -maxdepth 2 -type d -mtime +84 -print -exec rm -rf -- {} +
  find "$BACKUP_DIR/weekly" -mindepth 1 -maxdepth 1 -type d -empty -delete
fi

# ===== 5. 世代管理 =====
# Keep seven latest local daily generations only.
mapfile -t OLD_BACKUPS < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'p1228-*.db' -printf '%T@ %p\n' | sort -nr | awk 'NR>7 {$1=""; sub(/^ /,""); print}')
for old in "${OLD_BACKUPS[@]}"; do rm -f -- "$old" "$old.json"; done

echo "verified SQLite backup: $DB_FILE bytes=$SIZE sha256=$SHA (event payloads redacted)"

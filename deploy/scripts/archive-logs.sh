#!/usr/bin/env bash
set -Eeuo pipefail

# Local-only journal archive. No remote upload: archives stay on local disk
# under ARCHIVE_DIR and are pruned after RETENTION_DAYS.
# ===== 1. 設定と前提確認 =====
ARCHIVE_DIR="${P1228_LOG_ARCHIVE_DIR:-/var/spool/p1228/archive/logs}"
RETENTION_DAYS="${P1228_LOG_ARCHIVE_RETENTION_DAYS:-90}"
mkdir -p "$ARCHIVE_DIR"
command -v journalctl >/dev/null
command -v gzip >/dev/null

# ===== 2. アーカイブ検証 =====
# Verify a local archive is a readable gzip file and report its size/hash.
archive_one() {
  local file="$1" base service day local_size local_sha
  base="$(basename "$file")"
  [[ "$base" =~ ^([a-z0-9-]+)__([0-9]{4}-[0-9]{2}-[0-9]{2})\.jsonl\.gz$ ]] || return 0
  service="${BASH_REMATCH[1]}"
  day="${BASH_REMATCH[2]}"
  case "$service" in
    p1228-gateway | p1228-general | p1228-read-aloud-a | p1228-read-aloud-b | p1228-db-backup | p1228-log-archive | p1228-storage-monitor | system) ;;
    *)
      echo "Unknown log service prefix: $service" >&2
      return 1
      ;;
  esac
  gzip -t -- "$file" || {
    echo "gzip integrity check failed; keeping $file" >&2
    return 1
  }
  local_size="$(stat -c '%s' "$file")"
  local_sha="$(sha256sum "$file" | awk '{print $1}')"
  echo "archived locally: $file (service=$service day=$day bytes=$local_size sha256=$local_sha)"
}

# ===== 3. アーカイブ生成 =====
# Generate previous UTC day's journal archives.
DAY="$(date -u -d 'yesterday' +%F)"
UNITS=(system p1228-gateway p1228-general p1228-read-aloud-a p1228-read-aloud-b p1228-db-backup p1228-log-archive p1228-storage-monitor)
for unit in "${UNITS[@]}"; do
  file="$ARCHIVE_DIR/${unit}__${DAY}.jsonl.gz"
  [[ -s "$file" ]] && continue
  tmp="${file}.tmp"
  if [[ "$unit" == "system" ]]; then
    journalctl --utc --no-pager --since "$DAY 00:00:00" --until "$DAY 23:59:59" --priority=warning --output=json | gzip -9 >"$tmp"
  else
    journalctl --utc --no-pager --unit="$unit" --since "$DAY 00:00:00" --until "$DAY 23:59:59" --output=json | gzip -9 >"$tmp"
  fi
  mv "$tmp" "$file"
  archive_one "$file"
done

# ===== 4. 保持期間の整理 =====
# Prune archives older than the retention period. Local disk only; nothing
# is uploaded or deleted elsewhere.
find "$ARCHIVE_DIR" -maxdepth 1 -type f -name '*.jsonl.gz' -mtime "+$RETENTION_DAYS" -print -delete

#!/usr/bin/env bash
set -Eeuo pipefail

# ===== 1. 設定 =====
TARGET="${P1228_MONITOR_PATH:-/}"
DISK_WARN="${P1228_DISK_WARN:-70}"
DISK_CRIT="${P1228_DISK_CRIT:-85}"
DISK_EMERGENCY="${P1228_DISK_EMERGENCY:-95}"
INODE_WARN="${P1228_INODE_WARN:-70}"
INODE_CRIT="${P1228_INODE_CRIT:-85}"
INODE_EMERGENCY="${P1228_INODE_EMERGENCY:-95}"
WEBHOOK="${P1228_ALERT_WEBHOOK_URL:-}"

# ===== 2. 使用率の取得 =====
read -r disk_used _ < <(df -P "$TARGET" | awk 'NR==2 {gsub(/%/,"",$5); print $5, $2}')
read -r inode_used _ < <(df -Pi "$TARGET" | awk 'NR==2 {gsub(/%/,"",$5); print $5, $2}')
state="ok"
message="p1228 storage OK: disk=${disk_used}% inode=${inode_used}% target=${TARGET}"

# ===== 3. 状態判定 =====
classify() {
  local used="$1" warn="$2" crit="$3" emergency="$4"
  if ((used >= emergency)); then
    echo emergency
  elif ((used >= crit)); then
    echo critical
  elif ((used >= warn)); then
    echo warning
  else echo ok; fi
}
rank() { case "$1" in ok) echo 0 ;; warning) echo 1 ;; critical) echo 2 ;; emergency) echo 3 ;; esac }
disk_state="$(classify "$disk_used" "$DISK_WARN" "$DISK_CRIT" "$DISK_EMERGENCY")"
inode_state="$(classify "$inode_used" "$INODE_WARN" "$INODE_CRIT" "$INODE_EMERGENCY")"
if (($(rank "$inode_state") > $(rank "$disk_state"))); then state="$inode_state"; else state="$disk_state"; fi
case "$state" in
  warning) message="p1228 WARNING: disk=${disk_used}% inode=${inode_used}% target=${TARGET}. Identify growth and archive old logs." ;;
  critical) message="p1228 CRITICAL: disk=${disk_used}% inode=${inode_used}% target=${TARGET}. Prioritize pruning old local log archives; inspect Docker/audio cache." ;;
  emergency) message="p1228 EMERGENCY: disk=${disk_used}% inode=${inode_used}% target=${TARGET}. Free only known temporary data manually; do NOT auto-delete SQLite or Docker volumes." ;;
esac
# ===== 4. 結果出力とアラート通知 =====
printf '%s\n' "$message"
if [[ -n "$WEBHOOK" && "$state" != "ok" ]]; then
  payload="$(python3 -c 'import json,sys; print(json.dumps({"content":sys.argv[1]}))' "$message")"
  curl --silent --show-error --fail --max-time 10 -H 'Content-Type: application/json' --data "$payload" "$WEBHOOK" >/dev/null
fi

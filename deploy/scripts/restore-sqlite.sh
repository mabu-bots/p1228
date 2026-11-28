#!/usr/bin/env bash
set -Eeuo pipefail

# ===== 1. 概要と引数確認 =====
# Restore a local SQLite backup created by backup-sqlite.sh.
# The manifest (<backup>.json) next to the backup file provides the
# expected SHA-256. Nothing is downloaded from a remote store.
if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <local backup db path, e.g. /var/backups/p1228/sqlite/p1228-....db> <new local target path>" >&2
  exit 2
fi
SOURCE="$1"
TARGET="$2"
[[ -f "$SOURCE" ]] || {
  echo "Backup file not found: $SOURCE" >&2
  exit 1
}
[[ ! -e "$TARGET" ]] || {
  echo "Refusing to overwrite existing target: $TARGET" >&2
  exit 1
}
MANIFEST="${SOURCE}.json"
[[ -f "$MANIFEST" ]] || {
  echo "Manifest not found: $MANIFEST" >&2
  exit 1
}
command -v sqlite3 >/dev/null

# ===== 2. ハッシュと完全性の検証 =====
TMP="$(mktemp)"
TMP_SHA="${TMP}.sha"
trap 'rm -f "$TMP" "$TMP_SHA"' EXIT
cp -- "$SOURCE" "$TMP"
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$MANIFEST" >"$TMP_SHA"
EXPECTED="$(cat "$TMP_SHA")"
ACTUAL="$(sha256sum "$TMP" | awk '{print $1}')"
[[ "$EXPECTED" == "$ACTUAL" ]] || {
  echo "SHA-256 mismatch" >&2
  exit 1
}
CHECK="$(sqlite3 "$TMP" 'PRAGMA integrity_check;')"
[[ "$CHECK" == "ok" ]] || {
  echo "SQLite integrity_check failed: $CHECK" >&2
  exit 1
}
# ===== 3. 復元の実行 =====
install -D -m 0640 "$TMP" "$TARGET"
echo "Restored and verified to $TARGET. Stop p1228 services and inspect ownership before switching the active DB."

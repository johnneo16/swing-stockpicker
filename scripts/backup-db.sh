#!/usr/bin/env bash
# SwingPro daily DB backup.
#
# Backs up data/swingpro.db using SQLite's online .backup command (consistent
# even if the server is mid-write), then prunes anything older than 30 days.
#
# Schedule daily at 17:30 IST (after the 16:20 daily-summary job has written
# the end-of-day snapshot).
#
# Install:
#   chmod +x scripts/backup-db.sh
#   crontab -e
#   # then add this line (12:00 UTC == 17:30 IST):
#   0 12 * * * /Users/arindamchowdhury/Development/Web\ Dev/Swing\ Stockpicker\ Prototype/scripts/backup-db.sh >> ~/Library/Logs/swingpro-backup.log 2>&1

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${PROJECT_DIR}/data/swingpro.db"
BACKUP_ROOT="${HOME}/SwingProBackups"
TODAY="$(date +%Y-%m-%d)"
TARGET_DIR="${BACKUP_ROOT}/${TODAY}"
TARGET_FILE="${TARGET_DIR}/swingpro.db"

# 30-day rolling retention. Adjust here if you want longer/shorter.
RETENTION_DAYS=30

if [ ! -f "$DB_PATH" ]; then
  echo "$(date '+%Y-%m-%dT%H:%M:%S')  ✗ DB not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

# Use SQLite's online backup API — safe even with the server actively writing.
# Plain `cp` would risk a corrupt copy mid-transaction.
sqlite3 "$DB_PATH" ".backup '${TARGET_FILE}'"

# Sanity check the backup is readable and has the expected tables
TABLE_COUNT=$(sqlite3 "$TARGET_FILE" "SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
if [ "$TABLE_COUNT" -lt 5 ]; then
  echo "$(date '+%Y-%m-%dT%H:%M:%S')  ✗ Backup looks empty (only $TABLE_COUNT tables)" >&2
  exit 1
fi

# Compute size for the log
SIZE_KB=$(du -k "$TARGET_FILE" | awk '{print $1}')

# Prune old backups beyond retention
PRUNED=0
if [ -d "$BACKUP_ROOT" ]; then
  while IFS= read -r dir; do
    rm -rf "$dir"
    PRUNED=$((PRUNED + 1))
  done < <(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime "+${RETENTION_DAYS}")
fi

echo "$(date '+%Y-%m-%dT%H:%M:%S')  ✓ Backed up ${SIZE_KB} KB to ${TARGET_FILE}  (tables=${TABLE_COUNT}, pruned=${PRUNED})"

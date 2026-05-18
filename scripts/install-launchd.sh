#!/usr/bin/env bash
# Install all SwingPro launchd agents on macOS:
#   com.swingpro.server    — the engine + API (always running)
#   com.swingpro.backup    — daily DB backup (17:30 IST)
#   com.swingpro.watchdog  — health-check + auto-restart (every 5 min)
#
# Re-run safely — it unloads any existing instance first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs"

mkdir -p "$LAUNCH_DIR" "$LOG_DIR"

AGENTS=(
  "com.swingpro.server"
  "com.swingpro.backup"
  "com.swingpro.watchdog"
)

for agent in "${AGENTS[@]}"; do
  src="$SCRIPT_DIR/${agent}.plist"
  dest="$LAUNCH_DIR/${agent}.plist"

  if [ ! -f "$src" ]; then
    echo "✗ Source plist missing: $src" >&2
    exit 1
  fi

  if launchctl list | grep -q "$agent"; then
    echo "→ Unloading existing $agent"
    launchctl unload "$dest" 2>/dev/null || true
  fi

  cp "$src" "$dest"
  launchctl load -w "$dest"
  echo "✓ Installed + loaded $agent"
done

echo ""
sleep 2
echo "=== launchctl status ==="
launchctl list | grep -E 'swingpro\.' || echo "(no agents found — install failed)"

echo ""
echo "=== Logs ==="
echo "  Server :     tail -F $LOG_DIR/swingpro.out.log"
echo "  Server err:  tail -F $LOG_DIR/swingpro.err.log"
echo "  App log:     tail -F $LOG_DIR/swingpro-app.\$(date +%Y-%m-%d).log"
echo "  Backup:      tail -F $LOG_DIR/swingpro-backup.log"
echo "  Watchdog:    tail -F $LOG_DIR/swingpro-watchdog.log"

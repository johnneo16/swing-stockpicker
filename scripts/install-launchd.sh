#!/usr/bin/env bash
# Install the SwingPro launchd agent on macOS.
# Copies the plist to ~/Library/LaunchAgents, ensures log dir, then loads it.
# Re-run safely — it unloads any existing instance first.

set -euo pipefail

PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/com.swingpro.server.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.swingpro.server.plist"
LOG_DIR="$HOME/Library/Logs"

if [ ! -f "$PLIST_SRC" ]; then
  echo "✗ Source plist missing: $PLIST_SRC" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"

# If already loaded, unload first to pick up changes
if launchctl list | grep -q "com.swingpro.server"; then
  echo "→ Unloading existing agent…"
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

cp "$PLIST_SRC" "$PLIST_DEST"
echo "→ Installed plist at $PLIST_DEST"

launchctl load -w "$PLIST_DEST"
echo "✓ Loaded com.swingpro.server"

sleep 1
if launchctl list | grep -q "com.swingpro.server"; then
  echo "✓ Service running. Logs:"
  echo "    tail -F $LOG_DIR/swingpro.out.log"
  echo "    tail -F $LOG_DIR/swingpro.err.log"
else
  echo "✗ Service failed to start. Check $LOG_DIR/swingpro.err.log" >&2
  exit 1
fi

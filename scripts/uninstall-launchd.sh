#!/usr/bin/env bash
# Stop + uninstall the SwingPro launchd agent.

set -euo pipefail

PLIST_DEST="$HOME/Library/LaunchAgents/com.swingpro.server.plist"

if launchctl list | grep -q "com.swingpro.server"; then
  echo "→ Unloading agent…"
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

if [ -f "$PLIST_DEST" ]; then
  rm "$PLIST_DEST"
  echo "✓ Removed $PLIST_DEST"
else
  echo "ℹ No plist at $PLIST_DEST (already uninstalled)"
fi

echo "✓ Done. Logs retained at ~/Library/Logs/swingpro.*.log (delete manually if you want)"

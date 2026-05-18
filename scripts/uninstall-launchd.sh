#!/usr/bin/env bash
# Stop + uninstall all SwingPro launchd agents.

set -euo pipefail

LAUNCH_DIR="$HOME/Library/LaunchAgents"

AGENTS=(
  "com.swingpro.server"
  "com.swingpro.backup"
  "com.swingpro.watchdog"
)

for agent in "${AGENTS[@]}"; do
  dest="$LAUNCH_DIR/${agent}.plist"
  if launchctl list | grep -q "$agent"; then
    echo "→ Unloading $agent"
    launchctl unload "$dest" 2>/dev/null || true
  fi
  if [ -f "$dest" ]; then
    rm "$dest"
    echo "✓ Removed $dest"
  else
    echo "ℹ No plist at $dest (already uninstalled)"
  fi
done

echo ""
echo "✓ All agents removed. Logs retained at ~/Library/Logs/swingpro*.log"
echo "  (delete manually with: rm ~/Library/Logs/swingpro*.log)"

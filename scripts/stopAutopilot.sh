#!/usr/bin/env bash
# Stop the auto-pilot cleanly.

echo "🛑 Stopping SwingPro auto-pilot..."

if pgrep -f "node server.js" > /dev/null; then
  pkill -f "node server.js" && echo "  ✓ server stopped"
else
  echo "  (server already stopped)"
fi

if pgrep -f "caffeinate -dimsu" > /dev/null; then
  pkill -f "caffeinate -dimsu" && echo "  ✓ caffeinate stopped"
else
  echo "  (caffeinate already stopped)"
fi

rm -f /tmp/swingpro-server.pid /tmp/swingpro-caffeinate.pid

echo "✓ Done. DB + cache preserved at data/"

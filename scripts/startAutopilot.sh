#!/usr/bin/env bash
# SwingPro Auto-Pilot — one-command Monday-morning startup.
# Runs server + caffeinate in the background; survives terminal close.
#
# Usage:  bash scripts/startAutopilot.sh
#
# After this returns, the server will:
#   - Run on http://localhost:3001/
#   - Auto-fire pre-market scan at 09:00 IST every weekday
#   - Mark positions to market every 15 min during market hours
#   - Run exit cycles every 30 min
#   - EOD snapshot at 16:00, daily summary at 16:20, killswitch at 16:15
#   - Weekly backtest Saturday 10:00
#
# To check status later:  bash scripts/checkAutopilot.sh
# To stop:                bash scripts/stopAutopilot.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="/tmp/swingpro-prod.log"
PID_FILE="/tmp/swingpro-server.pid"
CAFF_PID_FILE="/tmp/swingpro-caffeinate.pid"

cd "$PROJECT_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SwingPro Auto-Pilot Startup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Kill any existing instance cleanly
if pgrep -f "node server.js" > /dev/null; then
  echo "🛑 Stopping existing server..."
  pkill -f "node server.js" || true
  sleep 2
fi
if pgrep -f "caffeinate.*swingpro\|caffeinate -dimsu" > /dev/null; then
  echo "🛑 Stopping existing caffeinate..."
  pkill -f "caffeinate -dimsu" || true
fi

# 2. Sanity: .env present?
if [ ! -f .env ]; then
  echo "❌ .env not found — Angel One credentials missing"
  exit 1
fi

# 3. Boot server with nohup so it survives this terminal closing
echo "🚀 Starting server..."
nohup node server.js > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"
disown $SERVER_PID 2>/dev/null || true
sleep 4

# 4. Verify server came up
if ! curl -sf --max-time 3 http://localhost:3001/api/health/db > /dev/null; then
  echo "❌ Server didn't come up — check $LOG_FILE"
  tail -20 "$LOG_FILE"
  exit 1
fi
echo "  ✓ Server up on http://localhost:3001/ (PID $SERVER_PID)"

# 5. Start caffeinate to keep Mac awake while server runs
echo "☕ Starting caffeinate..."
nohup caffeinate -dimsu -w "$SERVER_PID" > /tmp/swingpro-caffeinate.log 2>&1 &
CAFF_PID=$!
echo "$CAFF_PID" > "$CAFF_PID_FILE"
disown $CAFF_PID 2>/dev/null || true
echo "  ✓ caffeinate up (PID $CAFF_PID) — Mac won't auto-sleep while server runs"

# 6. Show orchestrator status
echo ""
echo "━━━ Orchestrator status ━━━"
curl -s http://localhost:3001/api/scheduler/status | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'  Running: {d[\"running\"]} | Active jobs: {sum(1 for j in d[\"jobs\"] if j[\"active\"])}/{len(d[\"jobs\"])} | Market open: {d[\"isMarketOpen\"]}')
for j in d['jobs']:
    print(f\"  ● {j['id']:20} {j['cron']}\")
"

# 7. Show database status
echo ""
echo "━━━ Database state ━━━"
node -e "
import('./src/persistence/db.js').then(({ db }) => {
  const t = db.prepare('SELECT COUNT(*) as n FROM trades').get();
  const o = db.prepare(\"SELECT COUNT(*) as n FROM trades WHERE status='open'\").get();
  const p = db.prepare('SELECT COUNT(*) as n FROM daily_picks').get();
  console.log('  Trades total:', t.n, ' Open:', o.n);
  console.log('  Daily picks recorded:', p.n);
});
"

echo ""
echo "━━━ ✅ Auto-pilot armed ━━━"
echo ""
echo "  • UI:        http://localhost:3001/"
echo "  • Live log:  tail -f $LOG_FILE"
echo "  • Status:    bash scripts/checkAutopilot.sh"
echo "  • Stop:      bash scripts/stopAutopilot.sh"
echo ""
echo "  Mac MUST stay open + plugged in for cron jobs to fire."
echo "  Run these once for stronger sleep prevention (will prompt for password):"
echo "    sudo pmset -a sleep 0 disksleep 0 powernap 0"
echo ""

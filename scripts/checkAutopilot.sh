#!/usr/bin/env bash
# Quick health-check on the running auto-pilot.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "━━━ Process check ━━━"
if pgrep -f "node server.js" > /dev/null; then
  ps -o pid,etime,command -p "$(pgrep -f 'node server.js' | head -1)" | tail -1 | sed 's/^/  ✓ /'
else
  echo "  ✗ Server is NOT running"
  exit 1
fi

if pgrep -f "caffeinate -dimsu" > /dev/null; then
  echo "  ✓ caffeinate active (Mac sleep prevented while server runs)"
else
  echo "  ⚠ caffeinate NOT running — Mac may sleep and stop cron"
fi

echo ""
echo "━━━ Health ━━━"
curl -s --max-time 3 http://localhost:3001/api/health/db | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  ✓ DB ok ({len(d[\"tables\"])} tables)')" 2>/dev/null || echo "  ✗ Server not responding"

echo ""
echo "━━━ Open positions ━━━"
curl -s --max-time 5 'http://localhost:3001/api/positions?mode=paper' 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
ps = d.get('positions', [])
if not ps: print('  (none)')
else:
    for p in ps:
        print(f\"  {p['symbol']:14} ₹{p.get('lastPrice', p['entryPrice']):>8} PnL ₹{p.get('unrealizedPnl', 0):>7} ({p.get('unrealizedPct', 0):>+.2f}%) held {p.get('heldDays', 0)}d\")
    print(f'  Total: {len(ps)}')
"

echo ""
echo "━━━ Portfolio ━━━"
curl -s --max-time 5 'http://localhost:3001/api/portfolio/live?mode=paper&capital=50000' 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"  Deployed ₹{d.get('capitalDeployed', 0):,} ({d.get('deploymentPct', 0)}%)  |  Cash ₹{d.get('cashRemaining', 0):,}  |  Unrealized ₹{d.get('unrealizedPnl', 0):,}\")
"

echo ""
echo "━━━ Journal stats (realized) ━━━"
curl -s --max-time 5 'http://localhost:3001/api/journal/stats?mode=paper' 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('totalTrades', 0) == 0:
    print('  (no closed trades yet)')
else:
    print(f\"  {d['totalTrades']} closed | win rate {round(d['winRate']*100)}% ({d['wins']}W/{d['losses']}L) | expectancy {d['expectancyPct']}% | realized ₹{d['totalPnl']}\")
"

echo ""
echo "━━━ Recent worker activity ━━━"
curl -s --max-time 5 'http://localhost:3001/api/scheduler/log?limit=10' 2>/dev/null | python3 -c "
import sys, json
runs = json.load(sys.stdin).get('runs', [])
for r in runs:
    icon = '✓' if r['status'] == 'ok' else ('✗' if r['status'] == 'error' else '○')
    print(f\"  {r['started_at'][11:19]} [{r['job_id']:20}] {icon} {(r.get('message') or '')[:80]}\")
"

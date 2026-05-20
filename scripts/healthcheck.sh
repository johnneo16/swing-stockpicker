#!/usr/bin/env bash
# SwingPro health-check watchdog.
#
# Probes the server's /api/health/macro endpoint. Restarts the launchd
# service if any of the following are true:
#   - HTTP probe doesn't return 200 within 8 seconds
#   - response.ok is not true
#   - scheduler.running is false (orchestrator stopped)
#   - The newest scheduler.jobs.lastRun across all jobs is > 90 minutes old
#     during NSE market hours (09:00–15:30 IST Mon–Fri)
#
# Why 90 minutes? mark-to-market fires every 15m and exit-cycle every
# 30m during market hours — if nothing has fired in 90m there is a
# genuine problem.
#
# Schedule: every 5 minutes via launchd (see com.swingpro.watchdog.plist).
# Logs to ~/Library/Logs/swingpro-watchdog.log.

set -euo pipefail

HEALTH_URL="${SWINGPRO_HEALTH_URL:-http://localhost:51280/api/health/macro}"
SERVICE_LABEL="${SWINGPRO_SERVICE_LABEL:-com.swingpro.server}"
PLIST_PATH="${HOME}/Library/LaunchAgents/${SERVICE_LABEL}.plist"
LOG_FILE="${HOME}/Library/Logs/swingpro-watchdog.log"
TIMEOUT_SEC=8
STALL_MINUTES=90

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

# Are we in market hours (IST 09:00 to 15:30 Mon-Fri)?
in_market_hours() {
  local hr_utc minute_utc dow
  # Convert local time to UTC then to IST offset (UTC+5:30)
  hr_utc=$(date -u '+%H')
  minute_utc=$(date -u '+%M')
  dow=$(date '+%u')  # 1=Mon..7=Sun
  [ "$dow" -gt 5 ] && return 1
  # IST = UTC + 5h30m. Convert UTC time to total minutes IST.
  local ist_min=$(( (10#$hr_utc * 60 + 10#$minute_utc + 330) % 1440 ))
  # Market hours IST: 09:00 (540 min) to 15:30 (930 min)
  [ "$ist_min" -ge 540 ] && [ "$ist_min" -le 930 ]
}

# Hit the health endpoint
response=$(curl -sS -m "$TIMEOUT_SEC" -o /tmp/swingpro-health.json -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
code=$response

if [ "$code" != "200" ]; then
  echo "$(ts)  ✗ health endpoint returned HTTP $code — restarting service" >> "$LOG_FILE"
  launchctl kickstart -k "gui/$(id -u)/${SERVICE_LABEL}" 2>>"$LOG_FILE" || true
  exit 0
fi

# Parse JSON via python (always available on macOS)
read -r is_ok scheduler_running newest_run_iso < <(
  python3 -c "
import json, sys, datetime as dt
d = json.load(open('/tmp/swingpro-health.json'))
is_ok = 'true' if d.get('ok') else 'false'
sched_running = 'true' if d.get('scheduler', {}).get('running') else 'false'
runs = [j.get('lastRun', {}).get('startedAt') for j in d.get('scheduler', {}).get('jobs', []) if j.get('lastRun')]
runs = [r for r in runs if r]
newest = max(runs) if runs else 'none'
print(is_ok, sched_running, newest)
")

if [ "$is_ok" != "true" ]; then
  echo "$(ts)  ✗ health.ok=false — restarting service" >> "$LOG_FILE"
  launchctl kickstart -k "gui/$(id -u)/${SERVICE_LABEL}" 2>>"$LOG_FILE" || true
  exit 0
fi

if [ "$scheduler_running" != "true" ]; then
  echo "$(ts)  ✗ scheduler.running=false — restarting service" >> "$LOG_FILE"
  launchctl kickstart -k "gui/$(id -u)/${SERVICE_LABEL}" 2>>"$LOG_FILE" || true
  exit 0
fi

# Stall check only during market hours (jobs don't fire after-hours by design)
if in_market_hours; then
  if [ "$newest_run_iso" = "none" ]; then
    echo "$(ts)  ⚠ market hours but no job has ever run — investigate" >> "$LOG_FILE"
  else
    age_min=$(python3 -c "
import datetime as dt
last = dt.datetime.fromisoformat('${newest_run_iso}'.replace('Z', '+00:00'))
now = dt.datetime.now(dt.timezone.utc)
print(int((now - last).total_seconds() / 60))
")
    if [ "$age_min" -gt "$STALL_MINUTES" ]; then
      echo "$(ts)  ✗ market hours but last job ran ${age_min}m ago (>${STALL_MINUTES}m) — restarting" >> "$LOG_FILE"
      launchctl kickstart -k "gui/$(id -u)/${SERVICE_LABEL}" 2>>"$LOG_FILE" || true
      exit 0
    fi
  fi
fi

# Healthy — log every 12th probe (~ hourly) to avoid noise
minute=$(date '+%M')
if [ "$((10#$minute % 60))" -lt 5 ]; then
  echo "$(ts)  ✓ healthy (scheduler running, last job ${newest_run_iso})" >> "$LOG_FILE"
fi

# SwingPro — Operations Runbook

Day-to-day reference for running, monitoring, and recovering the self-hosted
SwingPro server on macOS. Covers the three background agents, the killswitch,
DB backup/restore, and step-by-step recovery scenarios.

---

## Table of contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Quick status check (30 seconds)](#2-quick-status-check)
3. [Log files](#3-log-files)
4. [Agent health checks](#4-agent-health-checks)
   - 4a. [com.swingpro.server](#4a-comswingproserver)
   - 4b. [com.swingpro.backup](#4b-comswingprobackup)
   - 4c. [com.swingpro.watchdog](#4c-comswingprowatchdog)
5. [Killswitch — detection and recovery](#5-killswitch)
6. [DB backup and restore](#6-db-backup-and-restore)
7. [Restart procedures](#7-restart-procedures)
8. [Install from scratch (new machine)](#8-install-from-scratch)
9. [Morning checklist](#9-morning-checklist)
10. [Troubleshooting guide](#10-troubleshooting-guide)
11. [Cloud-migration prep notes](#11-cloud-migration-prep-notes)
12. [Telegram alerts + error journal](#12-telegram-alerts--error-journal)
13. [Backtest validation workflow](#13-backtest-validation-workflow)

---

## 1. Architecture at a glance

```
 macOS Login
     │
     ▼
com.swingpro.server  ←──── KeepAlive (auto-restarts on crash)
     │
     ├─ Express API on :3001
     ├─ Vite-built React SPA served from dist/
     └─ Orchestrator: ~10 cron jobs (IST, NSE-holiday-aware)

com.swingpro.watchdog  ←── StartInterval 300s (every 5 min)
     └─ Probes /api/health/macro
        → Restarts server if HTTP ≠ 200, ok=false,
          scheduler.running=false, or jobs stalled >90m during market hours

com.swingpro.backup  ←──── StartCalendarInterval 12:00 UTC (= 17:30 IST)
     └─ SQLite online backup to ~/SwingProBackups/YYYY-MM-DD/
        → Prunes copies older than 30 days
```

Self-healing surface:
- **Crash** → launchd KeepAlive restarts the server in ≤10 s
- **Stall** (orchestrator alive but jobs stopped) → watchdog restarts at the next 5-min probe
- **Corruption** → restore from `~/SwingProBackups/` (up to 30 daily snapshots)

---

## 2. Quick status check

Run these from any terminal session:

```bash
# Are all three agents loaded and running?
launchctl list | grep swingpro
# Healthy output: server has a PID; backup + watchdog show "-" (idle, not running now — correct)
#   96368  0  com.swingpro.server
#     -    0  com.swingpro.backup
#     -    0  com.swingpro.watchdog

# Hit the health endpoint directly
curl -s http://localhost:3001/api/health/macro | python3 -m json.tool | head -40

# Tail the live app log (structured JSON — one line per event)
tail -F ~/Library/Logs/swingpro-app.$(date +%Y-%m-%d).log

# Check watchdog for recent restart activity
grep -E '✗|✓' ~/Library/Logs/swingpro-watchdog.log | tail -20

# Verify tonight's backup exists
ls -lh ~/SwingProBackups/$(date +%Y-%m-%d)/swingpro.db 2>/dev/null || echo "backup not yet taken today"
```

---

## 3. Log files

| File | Written by | Contents |
|---|---|---|
| `~/Library/Logs/swingpro-app.YYYY-MM-DD.log` | pino (server process) | Structured JSON: every `console.*` call with level / time / pid / msg |
| `~/Library/Logs/swingpro.out.log` | launchd stdout redirect | Raw stdout if pino shim fails at startup |
| `~/Library/Logs/swingpro.err.log` | launchd stderr redirect | Uncaught exceptions, startup errors |
| `~/Library/Logs/swingpro-backup.log` | backup-db.sh | One line per daily run — ✓ size + table count, ✗ on failure |
| `~/Library/Logs/swingpro-watchdog.log` | healthcheck.sh | Probe results — ✓ hourly heartbeat, ✗ on any restart trigger |

**Rotation**: the app log rotates daily at midnight. Up to 7 days are kept in
`~/Library/Logs/`. Older days delete automatically.

**Parsing a structured log line:**
```bash
# Pretty-print the last 50 lines of today's app log
tail -50 ~/Library/Logs/swingpro-app.$(date +%Y-%m-%d).log | \
  python3 -c "import sys,json; [print(json.loads(l)['time'][:19], json.loads(l)['level'].upper()[:4], json.loads(l)['msg']) for l in sys.stdin]"

# Filter for errors only
grep '"level":"error"' ~/Library/Logs/swingpro-app.$(date +%Y-%m-%d).log | \
  python3 -m json.tool
```

---

## 4. Agent health checks

### 4a. com.swingpro.server

The main engine + API process. Should always have a PID.

```bash
# Is it running?
launchctl list com.swingpro.server
# "PID" key should be non-zero

# Confirm the port is open
lsof -nP -iTCP:3001 | grep LISTEN

# Confirm the API responds
curl -sf http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('ok' if d['ok'] else 'UNHEALTHY', 'scheduler:', d['scheduler']['running'])"

# Check the last job firings (shows all cron job names + last run time)
curl -s http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin)
for j in d['scheduler']['jobs']:
    lr = j.get('lastRun', {}).get('startedAt', 'never')
    print(f\"  {j['id']:<35} {lr}\")"
```

**Signs of trouble:**
- `launchctl list com.swingpro.server` shows exit code 1 or no PID → crashed
- `curl` returns connection refused → port not bound (server hasn't started yet or stuck)
- `scheduler.running = false` → orchestrator init failed; check `swingpro.err.log`

### 4b. com.swingpro.backup

A one-shot agent that fires once a day at 17:30 IST and exits. It should
**not** have a PID outside the brief window when it's actually running.

```bash
# Check the last backup log line
tail -5 ~/Library/Logs/swingpro-backup.log

# Verify the backup file from today (run after 17:30 IST)
sqlite3 ~/SwingProBackups/$(date +%Y-%m-%d)/swingpro.db \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
# Should return ≥ 5

# Force a backup right now (for testing or after a schema change)
launchctl start com.swingpro.backup

# List all available backup snapshots
ls ~/SwingProBackups/
```

**Signs of trouble:**
- Log shows `✗ DB not found` → `data/swingpro.db` missing; check server is running
- Log shows `✗ Backup looks empty` → backup file corrupt; remove it and re-run
- No log entry for today → agent may not be loaded; run `launchctl list | grep backup`

### 4c. com.swingpro.watchdog

Probes every 5 minutes. Should log at most one heartbeat line per hour
(suppressed by the `%60 < 5` guard in `healthcheck.sh`). Any `✗` line means
it found a problem and triggered a server restart.

```bash
# Is the watchdog loaded?
launchctl list com.swingpro.watchdog

# Recent probe activity
tail -30 ~/Library/Logs/swingpro-watchdog.log

# Force an immediate probe (useful after you've fixed something)
launchctl start com.swingpro.watchdog
```

**Interpreting watchdog log lines:**

| Pattern | Meaning |
|---|---|
| `✓ healthy (scheduler running, last job ...)` | Everything OK — logged ~hourly |
| `✗ health endpoint returned HTTP 000` | Server not responding at all — restarted |
| `✗ health.ok=false` | Server up but health check flagged an error |
| `✗ scheduler.running=false` | Orchestrator init failed on last startup |
| `✗ market hours but last job ran Xm ago (>90m)` | Scheduler stalled — restarted |
| `⚠ market hours but no job has ever run` | Server just started during market hours — investigate if it persists |

If the watchdog itself is repeatedly restarting the server without the
server staying up, look at `swingpro.err.log` for the root cause.

---

## 5. Killswitch

The killswitch is a **software gate** that disables the pre-market scan job
when the engine's rolling drawdown breaches the configured threshold (default
8%). It does **not** stop the server — it just prevents new picks from being
auto-tracked until you manually review and reset it.

### Detecting a trip

The killswitch status appears in three places:
1. **UI → Health tab** — red banner with the trip timestamp and reason
2. **Health API** — `curl -s http://localhost:3001/api/health/macro | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['killswitch'])"`
3. **DB directly** — `sqlite3 data/swingpro.db "SELECT * FROM settings WHERE key LIKE 'killswitch%'"`

A typical trip reason: `"drawdown >= 8%: rolling P&L -₹4250 on ₹50000 pool"`.

### Recovery procedure

**Step 1 — Understand why it tripped.** Do not reset blindly.

```bash
# What tripped it and when?
curl -s http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin); ks=d['killswitch']; print(ks)"

# Review open positions and recent closed trades in the UI (Live tab)
# Look at: setup types, win rate, any regime shift (Health tab → macro context)
```

**Step 2 — Decide.** If the drawdown was driven by a single bad week or a
temporary market dislocation, reset is appropriate. If you're seeing
systematic underperformance (many consecutive losses, regime detector showing
`risk_off_drawdown`), consider pausing paper trading until the system recovers.

**Step 3 — Reset via UI (recommended)**

Open the Health tab in the browser → click **Reset Killswitch**. This calls
`POST /api/scheduler/killswitch/reset` under the hood.

**Step 3 (alt) — Reset via curl**

```bash
curl -sX POST http://localhost:3001/api/scheduler/killswitch/reset \
  -H "Content-Type: application/json" | python3 -m json.tool
# Expected: {"success": true}
```

**Step 4 — Verify**

```bash
curl -s http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('killswitch tripped:', d['killswitch']['tripped'])"
# Should print: killswitch tripped: False
```

The pre-market job will fire normally at 08:45 IST the next trading day.

**Step 5 — DB confirmation (optional)**

```bash
sqlite3 data/swingpro.db \
  "SELECT key, value FROM settings WHERE key LIKE 'killswitch%'"
# Both killswitch:tripped_at and killswitch:reason should be empty strings
```

---

## 6. DB backup and restore

### Verify backups are healthy

```bash
# List all snapshots (should have one per trading day for the last 30 days)
ls -lh ~/SwingProBackups/

# Quick integrity check on today's backup
sqlite3 ~/SwingProBackups/$(date +%Y-%m-%d)/swingpro.db "PRAGMA integrity_check;"
# Expected output: "ok"

# Count rows to confirm data is present
sqlite3 ~/SwingProBackups/$(date +%Y-%m-%d)/swingpro.db \
  "SELECT 'trades', COUNT(*) FROM trades UNION SELECT 'positions', COUNT(*) FROM positions"
```

### Trigger a manual backup

```bash
# Safe to run with the server live — uses SQLite online backup API
launchctl start com.swingpro.backup
sleep 3
tail -3 ~/Library/Logs/swingpro-backup.log
```

### Restore from backup

**Restore replaces the live DB. Stop the server first.**

```bash
# 1. Stop the server
launchctl stop com.swingpro.server
sleep 3

# 2. Choose which snapshot to restore (most recent = today or yesterday)
ls ~/SwingProBackups/ | sort -r | head -10

# 3. Back up the current (possibly corrupt) DB just in case
cp data/swingpro.db data/swingpro.db.pre-restore-$(date +%Y%m%d%H%M)

# 4. Restore
SNAP="2025-01-15"   # replace with the date you want
cp ~/SwingProBackups/${SNAP}/swingpro.db data/swingpro.db

# 5. Verify the restored DB
sqlite3 data/swingpro.db "PRAGMA integrity_check;"
sqlite3 data/swingpro.db "SELECT COUNT(*) FROM trades;"

# 6. Restart the server (launchd KeepAlive will restart automatically,
#    but this makes it explicit)
launchctl start com.swingpro.server
sleep 5
curl -sf http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('restored server ok:', d['ok'])"
```

---

## 7. Restart procedures

### Soft restart (rolling — keeps launchd aware)

```bash
launchctl kickstart -k gui/$(id -u)/com.swingpro.server
# The server process exits, launchd starts a fresh one in <10 s
```

### Hard restart (unload + reload)

```bash
launchctl unload ~/Library/LaunchAgents/com.swingpro.server.plist
sleep 2
launchctl load -w ~/Library/LaunchAgents/com.swingpro.server.plist
```

### Restart all agents at once

```bash
cd "/Users/arindamchowdhury/Development/Web Dev/Swing Stockpicker Prototype"
bash scripts/uninstall-launchd.sh && bash scripts/install-launchd.sh
```

### Restart just the watchdog

```bash
launchctl kickstart -k gui/$(id -u)/com.swingpro.watchdog
```

### Stop everything (graceful shutdown)

```bash
bash scripts/uninstall-launchd.sh
# Agents removed from LaunchAgents/, server process exits
# Data is safe — SQLite writes complete on SIGTERM
```

---

## 8. Install from scratch (new machine)

```bash
# 1. Clone the repo
git clone <repo-url> "Swing Stockpicker Prototype"
cd "Swing Stockpicker Prototype"

# 2. Install Node dependencies
npm install

# 3. Create .env (see README.md → Environment section for all keys)
cp .env.example .env   # or create manually
# At minimum set API_KEY, CLIENT_ID, PIN, TOTP_SECRET if using Angel One

# 4. Edit the plist files — replace hardcoded paths with yours
#    Paths to update in each plist (3 files):
#      scripts/com.swingpro.server.plist   → ProgramArguments[0] (node binary)
#                                            WorkingDirectory
#                                            EnvironmentVariables PATH
#                                            StandardOutPath / StandardErrorPath
#      scripts/com.swingpro.backup.plist   → ProgramArguments[0]
#                                            StandardOutPath / StandardErrorPath
#      scripts/com.swingpro.watchdog.plist → ProgramArguments[0]
#                                            StandardOutPath / StandardErrorPath
#
#    Find your node binary: which node
#    Find your absolute project path: pwd

# 5. Build the React SPA
npm run build

# 6. Install the launchd agents
bash scripts/install-launchd.sh

# 7. Verify
sleep 5
launchctl list | grep swingpro
curl -sf http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('ok:', d['ok'])"
```

**Transferring data from an old machine:**

```bash
# On old machine — copy the latest backup
scp ~/SwingProBackups/$(date +%Y-%m-%d)/swingpro.db user@newmachine:~/

# On new machine — after completing steps 1-5 above but before step 6
cp ~/swingpro.db data/swingpro.db
sqlite3 data/swingpro.db "PRAGMA integrity_check;"

# Then install agents (step 6)
```

---

## 9. Morning checklist

Run between 08:30–09:00 IST on any trading day.

```bash
# 1. Confirm all three agents are loaded
launchctl list | grep swingpro

# 2. Confirm server is healthy
curl -sf http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin)
print('ok:', d['ok'])
print('scheduler:', d['scheduler']['running'])
print('killswitch tripped:', d['killswitch']['tripped'])
print('jobs:', len(d['scheduler']['jobs']), 'registered')"

# 3. Check for overnight watchdog restarts
grep '✗' ~/Library/Logs/swingpro-watchdog.log 2>/dev/null | \
  awk -F'  ' '{print $1}' | sort | uniq -c | tail -5
# Expected: empty output (no problems overnight)

# 4. Confirm yesterday's backup landed
ls -lh ~/SwingProBackups/$(date -v-1d +%Y-%m-%d)/swingpro.db 2>/dev/null || \
  echo "WARNING: yesterday's backup missing"

# 5. Open the UI
open http://localhost:3001
# → Health tab for live agent status
# → Today tab after 09:30 IST to see picks
```

---

## 10. Troubleshooting guide

### Server won't start / keeps restarting

```bash
# Check stderr for the actual error
tail -50 ~/Library/Logs/swingpro.err.log

# Common causes:
#   - Port 3001 already in use: lsof -nP -iTCP:3001 | grep LISTEN
#   - Missing .env: ls -la .env
#   - Missing node_modules: npm install
#   - DB locked (another process open): fuser data/swingpro.db
#   - Migration failure: look for "migration" in err log
```

### UI shows stale / no picks

```bash
# Did the morning scan actually fire?
curl -s http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin)
for j in d['scheduler']['jobs']:
    if 'scan' in j['id'] or 'pre-market' in j['id']:
        print(j['id'], '->', j.get('lastRun', {}).get('startedAt', 'never'))"

# Is today a market holiday?
node -e "
const { isNonTradingDay } = require('./src/scheduler/nseHolidays.js');
console.log('non-trading day:', isNonTradingDay(new Date()));
"
```

### Angel One login failing (TOTP race)

```bash
# Test authentication manually
node test_angelone.mjs

# If it logs "Login failed" or "TokenException":
#   - DON'T assume credentials are wrong — almost always a TOTP-window race
#     (fixed in the singleton-mutex auth path, but residual cases happen)
#   - Wait 10-15 minutes — Angel One throttles rapid re-auth
#   - ANGELONE_PASSWORD must be the 4-digit MPIN, NOT the login password
#   - ANGELONE_TOTP_SECRET is the 26-char base32 secret, not the QR URL
#   - The JWT disk cache saves a fresh TOTP on every cold-start — check:
ls -la data/angelone-session.json 2>/dev/null
# If corrupt / stale, delete it to force a fresh auth:
rm data/angelone-session.json
```

### Watchdog is looping (server keeps restarting)

```bash
# Check watchdog log for the restart reason
tail -50 ~/Library/Logs/swingpro-watchdog.log | grep '✗'

# Temporarily disable the watchdog while you diagnose
launchctl unload ~/Library/LaunchAgents/com.swingpro.watchdog.plist

# Fix the underlying issue, then re-enable
launchctl load -w ~/Library/LaunchAgents/com.swingpro.watchdog.plist
```

### DB integrity suspect

```bash
# Run full SQLite integrity check (takes a few seconds)
sqlite3 data/swingpro.db "PRAGMA integrity_check;"
# Healthy output: "ok"

# If output is anything else, restore from backup (see §6 above)
# Then check what caused the corruption (power loss during write is most common)
```

### Jobs firing at wrong times (IST offset issue)

All cron schedules in `src/scheduler/orchestrator.js` use `Asia/Kolkata`
explicitly. If jobs are off by 5:30 hours, the system timezone is being used:

```bash
# Check the machine timezone
sudo systemsetup -gettimezone
# Should be "Asia/Kolkata" or "Time zone: Asia/Kolkata"

# If not, set it
sudo systemsetup -settimezone "Asia/Kolkata"
```

---

---

## 11. Cloud-migration prep notes

The Mac launchd deployment is the validation environment. Once paper-trade
results prove stable (1–2 months), the system moves to cloud. M1.6 (Docker)
and M6 (cloud deploy) are the milestones that execute this — this section
captures the constraints to design for.

### Provider choice

| Provider | Status | Why |
|---|---|---|
| **Render paid (Starter $7/mo)** | Default plan | No sleep; persistent disk; managed Postgres add-on; simple Node deploy from `render.yaml` (already in repo) |
| **fly.io** | Backup plan | Free tier with persistent volume; multi-region if ever needed; needs Dockerfile |
| **Render free tier** | ❌ Do NOT use | Sleeps after 15 min HTTP inactivity → **kills all node-cron jobs**. Hard-blocker for an orchestrator-driven app |
| **Heroku** | ❌ Not considered | No free tier; dyno cycling complicates cron |

### What must change before cloud

1. **DB migration: better-sqlite3 → Postgres**
   - Current: synchronous SQLite, single-file at `data/swingpro.db`
   - Cloud: Postgres-compatible. Replace `db.js` repo layer; keep SQL as portable as possible (most of it already is)
   - Migrations: the `migrator.js` versioned-migrations pattern (M1.2) translates 1:1 — just swap the runner

2. **File-based caches → persistent disk or external store**
   - `data/angelone-session.json` (JWT cache) — needs writable persistent disk on Render, or migrate to encrypted env-stored cache
   - `data/historical/` (backtest price cache) — must live on persistent volume or be re-fetchable on cold start
   - `data/angelone-tokens.json` (symbol→token map) — regenerable, can ship in the image

3. **Log destination**
   - Current: pino-roll → `~/Library/Logs/swingpro-app.YYYY-MM-DD.log`
   - Cloud: pino → stdout (Render captures stdout into its log viewer). Set `LOG_DIR=` empty or detect via env to switch modes

4. **Health endpoint hardening**
   - `/api/health/macro` is the watchdog probe today. Cloud provider's healthcheck must hit it
   - Add a `/health` simple-200 endpoint for the load balancer separately from the deep `/api/health/macro` that the in-process watchdog probes

5. **Secrets**
   - Move every `ANGELONE_*` var into the cloud provider's secret store
   - Never bake secrets into the Docker image
   - `.env` is local-only; cloud reads env vars directly

6. **Timezone**
   - All cron schedules use `Asia/Kolkata` explicitly in `orchestrator.js`, so this works regardless of host timezone — but **set `TZ=Asia/Kolkata`** on the cloud instance anyway for logs to match the data

7. **NSE holiday calendar**
   - Hardcoded through 2026 in `src/scheduler/nseHolidays.js`. Refresh annually before cloud deploy and again every November after NSE publishes the next year's holiday list

### What stays the same

- The orchestrator design (node-cron + holiday gate) works identically on cloud, **as long as the instance doesn't sleep** (hence: no Render free tier)
- The Angel One singleton-mutex auth path works the same
- The killswitch logic is DB-state-driven, so it survives instance restarts
- The watchdog pattern collapses: in cloud, the platform's restart policy replaces `com.swingpro.watchdog`. Keep the `/api/health/macro` endpoint — it becomes the platform healthcheck

### Migration checklist (when you actually do it)

```
☐ Add Dockerfile + docker-compose.yml (M1.6)
☐ Replace better-sqlite3 with pg + connection pool
☐ Port the schema via migrator.js to a single 000_init.sql
☐ Re-run all backtests on the Postgres-backed build, confirm identical results
☐ Add /health (lightweight) alongside /api/health/macro (deep)
☐ Move ANGELONE_* and any other secrets to Render/fly secret store
☐ Configure pino to write to stdout when LOG_DIR is empty
☐ Set TZ=Asia/Kolkata in cloud env
☐ Deploy to staging, run for 2 weeks paper-trade in parallel with the Mac
☐ Compare paper-trade picks Mac vs cloud — must match within 1-2 picks/day
☐ Cut over: stop the Mac agents, point DNS / your bookmark at cloud
☐ Keep daily DB backups copying to local Mac for disaster recovery
```

### Cost ceiling

Target: **≤ $15/mo** total cloud spend (Render Starter $7 + managed Postgres
$7). If costs creep past this without a clear performance reason, fall back
to fly.io free tier with persistent volume.

---

---

## 12. Telegram alerts + error journal

The engine ships with an optional Telegram alert channel and a durable
SQLite error journal. Both are env-driven: without `TELEGRAM_BOT_TOKEN`
+ `TELEGRAM_CHAT_ID` the alert client cleanly no-ops while the journal
still records every error to the `error_log` table.

### One-time Telegram setup

1. **Create a bot** — open Telegram, message `@BotFather`, send `/newbot`,
   follow prompts. Copy the API token it returns (looks like
   `123456789:ABCdefGHI-jKLMnoPQR_STUvwxYZ`).
2. **Find your chat ID** — start a conversation with your new bot (send it
   any message), then visit
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser. Find
   `"chat":{"id":NNN}` in the JSON — `NNN` is your chat ID.
3. **Add to `.env`**:
   ```
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI-jKLMnoPQR_STUvwxYZ
   TELEGRAM_CHAT_ID=123456789
   ```
4. **Restart the server**:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.swingpro.server
   ```

### What gets alerted

| Event | Severity | Throttle |
|---|---|---|
| Killswitch trip | critical | 15 min dedupe on `killswitch:trip` |
| Uncaught exception in server | critical | 15 min per `source:message[:60]` |
| Unhandled promise rejection | critical | 15 min per `source:message[:60]` |
| Scheduled job error | error (journal only — no Telegram by default) | — |

Routine job errors are journaled but not alerted to avoid noisy pages.
If you want Telegram on a specific job error, pass `alert: true` to
`recordError()` at the call site.

### Verifying alerts work

```bash
# Trigger a synthetic critical alert end-to-end
curl -s -X POST http://localhost:3001/api/test/alert 2>/dev/null  # if you've added one
# Otherwise: tail the journal and force a known failure
curl -sX POST http://localhost:3001/api/scheduler/jobs/nonexistent/run
# Then check:
curl -s "http://localhost:3001/api/errors?limit=5" | python3 -m json.tool
```

### Reading the error journal

```bash
# Recent 50 errors (any severity)
curl -s http://localhost:3001/api/errors | python3 -m json.tool

# Only critical
curl -s "http://localhost:3001/api/errors?severity=critical&limit=20" | python3 -m json.tool

# Direct DB query
sqlite3 data/swingpro.db "
  SELECT occurred_at, severity, source, substr(message, 1, 80), alerted
  FROM error_log
  WHERE occurred_at >= datetime('now', '-7 days')
  ORDER BY occurred_at DESC
  LIMIT 20
"
```

### Pruning the journal

The journal is append-only. After a year of moderate usage it'll be
~MB-scale (not GB) so pruning is optional. To trim:

```bash
# Drop entries older than 90 days
sqlite3 data/swingpro.db \
  "DELETE FROM error_log WHERE occurred_at < datetime('now', '-90 days')"
```

### Disabling Telegram temporarily

Comment out or remove `TELEGRAM_BOT_TOKEN` from `.env` and restart. The
journal continues working; alerts cleanly no-op with
`{ sent: false, reason: 'disabled' }`.

---

## 13. Backtest validation workflow

Every engine change (scoring weight, gate threshold, new indicator) must
be validated against a **reproducible** backtest. Without this, run-to-run
variance from Yahoo Finance rate-limiting (~1pp gross-expectancy swing
between identical-config runs) masks real signal.

### The reproducibility flag

```bash
node scripts/runBacktest.js \
  --universe extended \
  --start 2022-01-01 --end 2024-12-31 \
  --capital 50000 --threshold 65 \
  --frozen-cache              # M5.6 — skip Yahoo tail-fetch, use cache as-is
```

`--frozen-cache` makes the backtest **byte-identical between runs** on the
same cache. Tested empirically — two consecutive runs produce matching
trade counts, win rates, expectancies. The cache may be older than today's
date, but stability is what enables apples-to-apples comparison.

### Before-and-after pattern

```bash
# 1. Lock the baseline (no code change yet)
node scripts/runBacktest.js --universe extended --start 2022-01-01 \
  --end 2024-12-31 --capital 50000 --threshold 65 --frozen-cache \
  > /tmp/baseline.log

# 2. Make your engine change (commit it locally)

# 3. Re-run with the same flags
node scripts/runBacktest.js --universe extended --start 2022-01-01 \
  --end 2024-12-31 --capital 50000 --threshold 65 --frozen-cache \
  > /tmp/candidate.log

# 4. Compare the headline + by-setup blocks
diff <(grep -E "Total trades:|Win rate:|Expectancy|Max drawdown:" /tmp/baseline.log) \
     <(grep -E "Total trades:|Win rate:|Expectancy|Max drawdown:" /tmp/candidate.log)
```

### Acceptance criteria

- **Expectancy must not regress** from the baseline (within ~0.05pp noise floor)
- **Max DD must not increase by more than 2pp**
- **Trade count change is informational** — large drops can indicate
  over-filtering; large jumps can indicate over-loose gating

### Refreshing the cache deliberately

When you want to incorporate new market data into the cache:

```bash
# Run WITHOUT --frozen-cache to let the loader fetch tail updates
node scripts/runBacktest.js --universe extended --start 2022-01-01 \
  --end 2024-12-31 --capital 50000 --threshold 65
```

Once that completes, the cache files in `data/historical/*.json` are
updated. Now use `--frozen-cache` for subsequent validation runs against
the new baseline.

### Cost-model knobs (M5.5)

All four NSE cost parameters are CLI-overridable for sensitivity analysis:

```bash
node scripts/runBacktest.js \
  --slippage-bps 20      # per-side slippage, default 20 (0.20%)
  --brokerage-bps 10     # per-side brokerage, default 10
  --stt-bps 10           # NSE Securities Transaction Tax (SELL side), default 10
  --stamp-bps 1.5        # stamp duty (BUY side), default 1.5
```

Set everything to 0 for an idealized fill simulation (no costs). The
backtest output includes `pnlPctNet` per trade and a per-trade
`costBreakdown { brokerage, stt, stamp, total }` ledger for auditing.

### What backtests can and cannot validate

| Subsystem | Backtest-validatable? |
|---|---|
| TA scoring weights | ✅ yes — engine runs full TA on cached candles |
| Setup-type routing | ✅ yes |
| ADX gate / MTF gate / R:R floor | ✅ yes |
| Cost model | ✅ yes (changes the net P&L numbers directly) |
| Position sizing / exit rules | ✅ yes |
| **Fundamentals scoring (PE, ROE, CFO, OPM, CAGR)** | ❌ **no** — backtest passes `fundamentals: null` (no point-in-time Screener data). Validate live via paper-trade observation |
| Regime detector | 🟡 partial — backtest doesn't feed a marketContext |
| Killswitch / Telegram alerts | ❌ no — runtime-only |

---

*Last updated: 2026-05-19. See `docs/VARSITY_COMPLIANCE.md` for the scoring
engine theory baseline and `docs/OUT_OF_SAMPLE_RESULTS.md` for backtest
validation methodology.*

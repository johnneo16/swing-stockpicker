# SwingPro — NSE Swing Trading Platform

A self-hosted, rule-based swing trading platform for the Indian stock and ETF
markets. Built around a 10-factor Wall-Street-grade scoring engine, a
walk-forward backtester, a paper-trading lifecycle, and a background
orchestrator that runs the whole loop unattended.

It does not give buy/sell calls. It identifies, scores, sizes, journals,
and reflects on swing-trade ideas (3–15 day horizon) so you can study
what works in your market — and where the engine is drifting.

---

## What it does

| Pillar | Modules |
| --- | --- |
| **Scan & rank** | 10-factor scoring (trend, momentum, volume, structure, candlesticks, OBV, fundamentals, regime, R:R, psychology) over the NSE universe + a curated ETF universe. Tier-3 fundamentals (CFO, Operating Margin, 5y Sales CAGR) per Varsity FA ch.6-7. |
| **Risk & sizing** | ATR-aware position sizing, sector caps, killswitch, per-class capital pools (stocks ₹50K, ETFs ₹25K), 60d pairwise correlation gate, 95% 1-day VaR |
| **Backtest** | Walk-forward simulator with warmup, asset-class isolation, equity curve, drawdown, expectancy, profit factor — saved as runs you can browse. Realistic NSE cost model (slippage + brokerage + STT + stamp duty) and `--frozen-cache` for reproducible engine-change validation. |
| **Paper trading** | Auto-tracked picks open as paper positions; the exit engine runs the full lifecycle (stops, BE moves at +1R, partials at +1.5R, trails at +2R, time stops, gap handling) |
| **Reflection** | Every closed trade gets a deterministic reflection (whatWorked / didn't / lesson / setup rating / would-retake) stored on the trade row |
| **Predicted vs actual** | Live widget that compares paper-journal stats to the most-recent backtest baseline — catches engine drift early |
| **Notifications** | Browser-native push for new picks + Telegram bot for ops-critical events (killswitch trip, uncaught errors). Env-driven, no-ops cleanly when unconfigured. |
| **Macro health** | Single-pane ops dashboard: uptime, DB size, per-job last firings, killswitch, provider status. DB-backed error journal (`/api/errors`) for durable post-incident review. |
| **NSE-aware** | Cron jobs check the 2025–26 NSE holiday calendar before firing |
| **Container-ready** | Two-stage Dockerfile + docker-compose with TZ=Asia/Kolkata baked in, non-root runtime, healthcheck wired. Image verified `(healthy)` locally. |
| **CI** | GitHub Actions runs tests + Vite build + Docker build on every push to `main` |

---

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Angel One    │  │ Yahoo (fb)   │  │ Screener.in  │
│ SmartAPI     │  │              │  │ (fundamentals)│
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       └─────────────────┼─────────────────┘
                         ▼
              ┌────────────────────┐
              │  dataFetcher       │
              │  + scoringEngine   │
              │  + riskEngine      │
              └─────────┬──────────┘
                        ▼
     ┌──────────────────────────────────────┐
     │  Orchestrator (node-cron, holiday-   │
     │  aware): pre-market, intraday refresh,│
     │  exit cycle, EOD reconciliation       │
     └─────────┬──────────────────┬─────────┘
               ▼                  ▼
       ┌──────────────┐   ┌──────────────┐
       │ positionTrkr │   │ exitEngine   │
       │ (paper)      │   │              │
       └──────┬───────┘   └──────┬───────┘
              └─────────┬────────┘
                        ▼
              ┌────────────────────┐
              │ SQLite (better-    │
              │ sqlite3) + repos   │
              └─────────┬──────────┘
                        ▼
              ┌────────────────────┐
              │ Express + React 18 │
              │ Tabs: Today /      │
              │ Dashboard / Trades │
              │ / Portfolio / Live │
              │ / Backtests /Health│
              └────────────────────┘
```

All state is local: SQLite (`data/swingpro.db`), no cloud, no paid host.

---

## The scoring engine — what it evaluates

The engine combines a **10-factor 0–100 confidence score** with **10 hard
pre-rank gates** and a **7-point Varsity checklist** shown on every card.
This is the entire basis on which it shortlists or refuses a trade.

### A. The 10 weighted factors (0–100)

Weights are the v2 baseline. A v3 rebalance that pushed Price Action to
18 and Structure to 12 empirically *degraded* expectancy in backtests and
was reverted; the current values are the empirically-validated set.

| # | Factor | Weight | Concrete signals checked |
| --- | --- | --- | --- |
| 1 | **Momentum** | 15 | RSI(14) zone 40–65 (healthy bullish); MACD bullish + histogram rising; MACD fresh crossover |
| 2 | **Trend Alignment** | 13 | Price > EMA20 > EMA50; EMA200 stack; EMA20 + EMA50 slopes rising. M5.3 adds the **9/21 EMA pair** — fresh ema9-over-ema21 cross gives short-swing entry timing (+1.5 trend points, clamped under cap). |
| 3 | **Risk–Reward** | 12 | Target/stop ratio: 3.0×→12 pts, 2.5×→10, 2.0×→7, 1.5×→3, <1.5×→0 |
| 4 | **Price Action** | 11 | Bear/bull traps; bullish/bearish rejection wicks at S/R; retest bounces; trendline interactions; breakouts |
| 5 | **Volume Profile** | 10 | RVOL > 1.2× 10d-avg (Varsity ch.12 baseline) or > 2.0× (spike); volume drying flagged |
| 6 | **Fundamentals** | 10 | Scraped from Screener.in: P/E (Varsity ≤16/22/30 bands), ROE (≥18 good / ≥25 DD), ROCE, D/E (>1 caution). **M5.2 Tier-3:** 5y avg CFO (positive vs cash-burning), Operating Margin (≥25% premium / ≥15% quality / ≥10% average), 5y Sales CAGR (≥20% strong / ≥10% steady / <0 declining). |
| 7 | **Market Context** | 10 | Nifty trend (bullish/bearish/neutral); market mood; regime detector output |
| 8 | **Psychology** | 9 | RSI > 75 penalty; dayChange > 5% penalty (FOMO guard); multi-signal confluence bonus |
| 9 | **Candlestick Patterns** | 5 | Marubozu (bull/bear), Three White Soldiers, Morning Star, Bullish Engulfing, Hammer, Dragonfly Doji, Bullish Harami |
| 10 | **Market Structure** | 5 | HH/HL + OBV + **validated trendlines (≥3 touches)** + Varsity S/R zones + Dow patterns + Fibonacci confluence |

Total score must reach **≥ 65** to enter Pass 1 (strict). Threshold was
raised from 50 → 65 based on per-bucket expectancy data — the 60-69 bucket
is roughly break-even after commission, the 70+ bucket carries the edge.
Below 65, a Pass-2 fallback fills remaining slots with the best-available,
tagged as low confidence.

**M5.4 — Central Pivot Range**: daily PP / BC / TC computed from prior-day
HLC. Levels are surfaced on every TradeCard for trader display, but do
*not* contribute to scoring. The naive scoring rubric (above-TC + narrow-
CPR = bonus) was empirically rejected — it lowered expectancy by 0.45pp
in backtest due to signal double-counting with the existing trend/structure
machinery. Smarter integration deferred.

### B. Hard pre-rank gates (every gate must pass)

| Gate | Rule | Source |
| --- | --- | --- |
| **R:R floor** | riskRewardRatio ≥ 1.5 | Varsity TA ch.11 |
| **Confidence floor** | totalScore ≥ 65 | Backtest-tuned (3yr × 198 stocks sweep) |
| **ADX trend-strength** | Trending setups (Trend Continuation, Breakout, MACD Crossover, Three White Soldiers) refused when ADX < 25. Mean-reversion setups refused when ADX > 30. | Varsity TA ch.20 |
| **MTF confluence** | Trending longs refused when weekly trend is confirmed DOWN (resampled weekly EMA20+50 stack + slope) | Varsity TA Finale ch.19 + Dow Theory ch.17–18 |
| **Sector cap** | Max 3 positions per sector | Risk Engine |
| **Pairwise correlation** | New open refused if 60d return correlation with any existing position > 0.75 | Varsity Risk Mgmt ch.3–5 |
| **Capital + cash reserve** | Per-class capital pool, 15% min cash reserve, 2% max risk/trade | Risk Engine |
| **Killswitch** | Pre-market disabled when rolling DD > 8% or over-leveraged | Risk Engine |
| **Earnings blackout** | Auto-block names with results in next 5 trading days | NSE board-meetings calendar |
| **Regime gating** | Score nudge ±10 + size multiplier 0.4–1.4× based on detected regime (bullish_trending, choppy, risk_off_drawdown, etc.) | Regime Detector |

### C. Per-pick Varsity 7-gate checklist (shown on every TradeCard)

A transparent green/grey 7-dot strip on the card, so you see exactly
which Varsity pillar each pick clears. Matches Varsity TA Finale
ch.19 §19.5 prescription verbatim:

1. **Pattern** — recognized candlestick pattern present
2. **Prior trend** — bullish pattern preceded by a downtrend (cardinal Varsity rule)
3. **Volume** — current vol ≥ 10-day avg
4. **S/R** — entry aligned with support or fresh breakout level
5. **Dow** — primary trend confirms (EMA stack / HH-HL / weekly bullish)
6. **R:R** — risk-reward ≥ 1.5
7. **MACD + RSI** — both indicators confirm direction

Source: Varsity Technical Analysis module Finale chapter (ch.19 §19.5).

### D. Setup types the engine recognizes

Each pick is tagged with one setup type, used downstream for ADX gating,
MTF gating, and per-setup performance tracking:

- **Tier-A (empirical winners)**: Bear Trap Reversal · Support Rejection Wick
- **Tier-B (price-action confirmed)**: Trendline + Price Action
- **Tier-C (continuation)**: Bullish Marubozu · Bullish Flag
- **Tier-D (legacy)**: Trend Continuation / HH/HL Trend Continuation · Breakout / Breakout + ADX Trend · Three White Soldiers · Morning Star Reversal / Engulfing at Support / Hammer at Support · MACD Crossover · OBV Bullish Divergence · Pullback / RSI Reversal · Bollinger Squeeze / Mean Reversion · Consolidation + Support · Volume Surge
- ETF variants of the above for the ETF universe

### E. Position sizing & risk math

- **ATR-aware sizing**: position scaled inversely to ATR/price ratio
  (high-vol stocks get smaller positions; low-vol stocks get larger)
- **Confidence bump**: high-conviction trades (score ≥ 70) get a small
  size multiplier; low-confidence get cut
- **Stop loss**: structure-based — swing low minus ATR buffer, with
  guard rails (never wider than 2× ATR, never tighter than 0.5× ATR)
- **Target**: resistance-based — next swing high or pivot R1, falling
  back to ATR × multiple when no resistance is mapped
- **Holding-days estimate**: priceMoveNeeded / (0.5 × ATR per day)
- **Per-class capital pools**: stocks ₹50K, ETFs ₹25K
- **Cash reserve**: 15% of pool always kept idle for repair/scale-in
- **Max risk per trade**: 2% of pool

### F. Portfolio-level risk (Varsity Risk-Mgmt module)

Beyond per-trade sizing, the engine continuously monitors the portfolio:

- **95% 1-day VaR** (historical method) over the 60-day window —
  shown on Health tab, red flag when > 4% of capital
- **Correlation matrix** of all open positions — max pair surfaced;
  red flag when any pair > 0.75
- **Sector exposure** — already capped at 3 per sector
- **Killswitch** — trips automatically on drawdown breach or
  over-leverage; disables pre-market job until reset
- **System Decay Monitor** — z-score of recent-window expectancy vs
  baseline; alarms when recent < baseline − 1σ (catches regime change
  before account drawdown)

### G. System-grade metrics (Live tab & Backtests)

Reported in addition to win-rate / expectancy / profit-factor:

| Metric | Formula | Good ≥ |
| --- | --- | --- |
| **Sharpe** | mean(returns) / std × √252 | 1.0 |
| **Sortino** | mean / downside-std × √252 | 1.5 |
| **SQN** (Van Tharp) | (mean / std) × √n | 2.5 = good, 5 = superb |
| **MAR ratio** | totalReturnPct / maxDrawdownPct | 0.5 |

### H. The trading-school basis

The evaluation criteria above are not invented — they map directly to
specific chapters of **Zerodha Varsity**, India's most-respected free
trading curriculum:

- **Technical Analysis** (22 ch) → factors 1-4, 9; candlestick set; ADX gate (ch.20, threshold 25); volume window 10-day (ch.12); prior-trend gate for reversal patterns (ch.4-10); 7-gate checklist (ch.19); MTF (ch.19 + Dow ch.17-18)
- **Trading Systems** (16 ch) → backtester design, system-grade metrics, decay monitor
- **Risk Management & Trading Psychology** (16 ch) → variance/covariance/correlation matrix (ch.3-5), VaR (ch.10), position sizing (ch.11-13), Kelly (ch.14), bias tagging (ch.15-16)
- **Fundamental Analysis** (16 ch) → factor 7 (P/E ch.11, ROE ch.9, ROCE, D/E ch.10, Varsity-spec thresholds)
- **Sector Analysis** (17 ch) → sector cap rule + sector rotation in regime detector

**Full chapter-by-chapter audit:** see [`docs/VARSITY_COMPLIANCE.md`](docs/VARSITY_COMPLIANCE.md) for the complete compliance matrix — what we match exactly (✅), what's partial (🟡), what's missing (❌), with the Varsity-prescribed values vs our current values for every rule.

The engine intentionally produces few signals on weak days. If nothing
clears all the gates, the Today tab shows nothing — and that is the
correct behavior.

---

## Risk management

Five layers, every one of which can refuse a trade:

1. **Capacity** — sector caps (3 / sector), total open positions, regime gating.
2. **Capital** — per-class pools (stocks ₹50K, ETFs ₹25K), 2% max risk
   per trade, 15% cash reserve.
3. **Correlation** — 60d return correlation gate (refuses opens > 0.75
   with any existing position; Varsity Risk-Mgmt ch.3-5).
4. **Portfolio VaR** — 95% 1-day Value-at-Risk monitored continuously;
   flagged when > 4% of capital (Varsity Risk-Mgmt ch.10).
5. **Killswitch** — trips the pre-market job if the rolling P&L drawdown
   crosses the configured threshold; resets only via UI button.

Position sizing is ATR-aware. The exit engine moves stops to break-even
when a position hits +1R, books a 50% partial at +1.5R, then trails the
remainder by 5% of price (or the existing stop, whichever is higher)
once the trade clears +2R. Time stops fire at 25 holding days. Panic
exit fires on an intraday gap-down loss > 7%.

---

## Out-of-sample validation

The engine is validated as not curve-fit. Earlier non-frozen runs:

- In-sample (2024): expectancy **+1.74%/trade**
- Out-of-sample (2025): expectancy **+1.75%/trade**

See `docs/OUT_OF_SAMPLE_RESULTS.md` for the methodology and per-bucket
breakdown.

The current **frozen-cache baseline** (2022-01-01 → 2024-12-31, 198-stock
extended universe, threshold 65, ₹50K — reproducible run-to-run via
`--frozen-cache`) sits at **+1.05% gross expectancy / 45.3% win / +19.33%
total return / 10.83% max DD**. The two numbers aren't directly comparable
— the older ones were single-shot samples of a tail-fetching loader and
predate the M5.5 STT/stamp cost additions. Going forward, all engine-
change validation uses the frozen-cache pattern documented in
`docs/RUNBOOK.md` §13.

Realistic expectation when paper-traded live: **8–16% annualized** on
a ₹50K stock pool, with drawdowns reaching 6–10%. Anyone promising
more from a rule-based system is selling something.

---

## The orchestrator

`src/scheduler/orchestrator.js` registers 11 cron jobs, all in
`Asia/Kolkata`. Headline jobs:

| Job | Schedule (IST) | Purpose |
| --- | --- | --- |
| pre-market | 09:00 Mon–Fri | Generate today's picks + auto-track |
| auto-scan | every 30m, 09–15 Mon–Fri | Re-scan for new opportunities |
| mark-to-market | every 15m, 09–15 Mon–Fri | Update unrealized P&L on open positions |
| exit-cycle | every 30m, 09–15 Mon–Fri | Apply exit rules (stop / target / BE / trail / partial / time) |
| earnings-refresh | 07:30 + 16:30 Mon–Fri | Refresh NSE board-meetings calendar |
| stale-trade-audit | 16:05 Mon–Fri | Flag positions held 1.5× their estimated window |
| risk-killswitch | 16:15 Mon–Fri | Trip killswitch if rolling DD > 8% |
| daily-summary | 16:20 Mon–Fri | Generate end-of-day summary |
| eod-snapshot | 16:30 Mon–Fri | Close day, write equity-curve point |
| weekly-backtest | 10:00 Saturday | Rolling 2-yr walk-forward refresh |

Every job checks `isNonTradingDay()` (weekend + 2025/26 NSE holiday
calendar) before firing. Failures emit to the DB error journal
(`error_log`) and, when configured, page Telegram.

---

## UI tabs

- **Today** — auto-tracked picks for today, blocked-with-reason list
- **Dashboard** — top 5 trade cards
- **Trades** — full ranked list, stocks/ETF toggle, conviction filter
- **Portfolio** — sector exposure, cash deployment, risk used
- **Live** — paper positions, P&L, equity curve, predicted-vs-actual,
  setup performance breakdown, closed-trades table with expandable
  reflection rows
- **Backtests** — runs browser with per-run trade list
- **Health** — uptime, memory, DB, per-job cron status, killswitch,
  data counts

---

## Setup

### Requirements
- Node.js 20.19.2 (pinned in `scripts/com.swingpro.server.plist`, the Dockerfile base, and the CI workflow — bump deliberately, not opportunistically)
- Angel One account (optional but recommended; Yahoo Finance is the fallback)
- macOS for the launchd background-service scripts, OR Docker for any other host

### Environment

`.env` in the project root:

```env
# Angel One SmartAPI (optional — Yahoo Finance falls back if missing)
ANGELONE_API_KEY=...           # 8-char API key from the SmartAPI portal
ANGELONE_CLIENT_ID=...         # 10-char Angel One client ID (format: AAAA000000)
ANGELONE_PASSWORD=...          # 4-digit trading MPIN — NOT your login password
ANGELONE_TOTP_SECRET=...       # 26-char base32 secret from the QR (not the QR URL)

# Server
PORT=3001
NODE_ENV=production            # use "development" only when running npm run dev

# Optional overrides
SWINGPRO_DB=./data/swingpro.db # default
LOG_LEVEL=info                 # debug | info | warn | error — defaults to info in prod
LOG_DIR=                       # defaults to ~/Library/Logs on macOS
DISABLE_LOG_SHIM=              # set to 1 to bypass the pino console-shim (debug only)

# Telegram alerts (optional — engine no-ops cleanly without these)
TELEGRAM_BOT_TOKEN=            # from @BotFather — see RUNBOOK.md §12
TELEGRAM_CHAT_ID=              # your numeric chat ID
```

`.env` is gitignored — never commit it. The Angel One JWT cache at
`data/angelone-session.json` is also gitignored.

### Development (local, hot-reload)

```bash
npm install
npm run server     # Express + orchestrator on :3001
npm run dev        # Vite dev server on :5173 (proxies /api to :3001)
```

### Production (self-hosted on macOS)

```bash
npm install
npm run build                    # compile React SPA into dist/
bash scripts/install-launchd.sh  # registers all three launchd agents
```

The install script sets up:
- **`com.swingpro.server`** — engine + API, restarts automatically on crash (KeepAlive)
- **`com.swingpro.backup`** — daily DB backup at 17:30 IST (30-day rolling retention)
- **`com.swingpro.watchdog`** — probes `/api/health/macro` every 5 min, auto-restarts on stall

```bash
# Verify everything is up
launchctl list | grep swingpro
curl -s http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('ok:', d['ok'])"

# Open the UI
open http://localhost:3001
```

To stop and remove all agents: `bash scripts/uninstall-launchd.sh`

### Docker (portable, cloud-ready)

For non-macOS hosts or as a staging build before cloud deploy:

```bash
# Build the image and start (compose handles env, volumes, healthcheck)
docker compose up -d --build

# Tail structured logs (stdout-only in container mode)
docker compose logs -f swingpro

# Health check
curl -sf http://localhost:3001/api/health/macro | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('ok:', d['ok'])"

# Stop (DB volume `swingpro-data` is preserved)
docker compose down
```

Notes:
- The image runs as a non-root user, with `TZ=Asia/Kolkata` baked in so the
  cron scheduler fires at correct IST times regardless of host timezone.
- Logs go to stdout only (`LOG_STDOUT_ONLY=1`) — the platform captures them.
  Use `docker compose logs` or your cloud provider's log viewer.
- The SQLite DB lives on a named volume (`swingpro-data`) mounted at
  `/app/data`. `docker compose down -v` deletes it — restore from
  `~/SwingProBackups/` (see RUNBOOK §6).
- `.env` is mounted at runtime via `env_file`, never baked into the image.

**Full ops reference** (daily checks, killswitch recovery, DB restore, new-machine
install, troubleshooting, cloud-migration prep): see [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

---

## Repo layout

```
server.js                        Express + API routes; top-level uncaught handlers
src/
  logger.js                      pino + console-shim + daily rotation (M1.3)
                                 LOG_STDOUT_ONLY=1 disables file transport (Docker/cloud)
  alerts/                        Telegram bot + DB error journal (M3)
    telegram.js                  env-driven client, 15-min dedupe throttling
    errorJournal.js              recordError() persists to error_log table
  engine/                        scoring, risk, data fetching, providers
                                 (scoringEngine, technicalAnalysis, fundamentalAnalysis,
                                  riskEngine, dataFetcher, angelOneProvider, universes)
  intelligence/                  regime detector, earnings, portfolio risk, reflection
  lifecycle/                     positionTracker, exitEngine
  scheduler/                     orchestrator, jobs, nseHolidays
  backtest/                      walk-forward engine, simulator, metrics, historicalLoader
  persistence/                   SQLite schema + repos
    migrations/                  versioned migrations 001..004
  components/                    React UI (tabs + cards + widgets)
tests/
  setup.js                       Vitest setup: SWINGPRO_DB=:memory:, log shim off
  golden/                        golden-fixture snapshot tests
scripts/
  runBacktest.js                 CLI backtester (--frozen-cache + cost knobs)
  install-launchd.sh             register all three macOS background agents
  uninstall-launchd.sh           stop + remove all agents
  backup-db.sh                   SQLite online backup (called by launchd agent)
  healthcheck.sh                 health probe (called by watchdog agent)
  com.swingpro.server.plist      launchd plist — main server (KeepAlive)
  com.swingpro.backup.plist      launchd plist — daily backup at 17:30 IST
  com.swingpro.watchdog.plist    launchd plist — 5-min health probe
docs/
  RUNBOOK.md                     ops runbook: daily checks, killswitch, restore,
                                 Telegram setup, backtest validation workflow
  VARSITY_COMPLIANCE.md          scoring engine vs Zerodha Varsity audit
  OUT_OF_SAMPLE_RESULTS.md       2025 out-of-sample validation findings
.github/workflows/ci.yml         tests + Vite build + Docker build on every push
Dockerfile                       two-stage build, non-root, TZ=Asia/Kolkata
docker-compose.yml               local stack with persistent named volume
.dockerignore                    excludes .env, HANDOFF.md, data/, .git
data/
  swingpro.db                    local SQLite (gitignored)
  historical/                    backtest price cache (gitignored)
```

---

## Disclaimer

This is an educational and research platform. Nothing it produces is
financial advice. Trading the NSE involves the real possibility of
losing money. Paper-trade for at least a quarter before considering
real capital, and even then, size down and re-validate.

## License

MIT — © Arindam Chowdhury

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
| **Scan & rank** | 10-factor scoring (trend, momentum, volume, structure, candlesticks, OBV, fundamentals, regime, R:R, psychology) over the NSE universe + a curated ETF universe |
| **Risk & sizing** | ATR-aware position sizing, sector caps, killswitch, per-class capital pools (stocks ₹50K, ETFs ₹25K) |
| **Backtest** | Walk-forward simulator with warmup, asset-class isolation, equity curve, drawdown, expectancy, profit factor — saved as runs you can browse |
| **Paper trading** | Auto-tracked picks open as paper positions; the exit engine runs the full lifecycle (stops, BE moves, partials, trails, time stops, gap handling) |
| **Reflection** | Every closed trade gets a deterministic reflection (whatWorked / didn't / lesson / setup rating / would-retake) stored on the trade row |
| **Predicted vs actual** | Live widget that compares paper-journal stats to the most-recent backtest baseline — catches engine drift early |
| **Notifications** | Browser-native push for new picks, exits, and scheduler events (polling-based, no service worker) |
| **Macro health** | Single-pane ops dashboard: uptime, DB size, per-job last firings, killswitch, provider status |
| **NSE-aware** | Cron jobs check the 2025–26 NSE holiday calendar before firing |

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

## The scoring engine

10 factors, normalized to 0–100, weighted, then ranked. The engine emits
a structured trade card (entry, stop, target, R:R, est days, setup type,
sector exposure, regime tag, confidence band).

Setup types it identifies include:
- Trend Continuation
- Breakout Pullback
- Mean Reversion
- Bollinger Squeeze
- Earnings Drift
- Sector Rotation
- ETF Trend / ETF Mean Reversion

The engine intentionally produces few signals on weak days. If nothing
clears the confidence threshold, the Today tab shows nothing — and that
is the correct behavior.

---

## Risk management

Three layers, every one of which can refuse a trade:

1. **Capacity** — sector caps, total open positions, regime gating.
2. **Capital** — per-class pools (stocks ₹50K, ETFs ₹25K), 2% max risk
   per trade, 15% cash reserve.
3. **Killswitch** — trips the pre-market job if the rolling P&L drawdown
   crosses the configured threshold; resets only via UI button.

Position sizing is ATR-aware. The exit engine moves stops to break-even
when a position hits +1R, books partials at +2R, then trails the rest.
Time stops fire if the trade meanders past its estimated holding window.

---

## Out-of-sample validation

The engine is validated as not curve-fit. Same config:

- In-sample (2024): expectancy **+1.74%/trade**
- Out-of-sample (2025): expectancy **+1.75%/trade**

See `docs/OUT_OF_SAMPLE_RESULTS.md` for the methodology and per-bucket
breakdown.

Realistic expectation when paper-traded live: **8–16% annualized** on
a ₹50K stock pool, with drawdowns reaching 6–10%. Anyone promising
more from a rule-based system is selling something.

---

## The orchestrator

`src/scheduler/orchestrator.js` runs ~10 cron jobs (Asia/Kolkata):

| Job | Schedule | Purpose |
| --- | --- | --- |
| pre-market | 08:45 | Refresh universe, regime, earnings calendar |
| morning scan | 09:30 | First stock + ETF scan, auto-track picks |
| intraday refresh | every 30m | Mark-to-market open positions |
| exit cycle | every 15m | Apply exit rules to open positions |
| EOD reconcile | 16:00 | Close day, write equity-curve point |
| weekly backtest | Sat 06:00 | Rolling walk-forward refresh |

Every job checks `isNonTradingDay()` (weekend + 2025/26 NSE holiday list)
before firing.

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
- Node.js 18+
- Angel One account (optional but recommended; Yahoo is the fallback)

### Environment

`.env` in the project root:

```env
# Angel One SmartAPI (optional — Yahoo Finance falls back if missing)
API_KEY=...
CLIENT_ID=...
PIN=...
TOTP_SECRET=...

# Server
PORT=3001
NODE_ENV=development

# Optional overrides
SWINGPRO_DB=./data/swingpro.db   # default
```

### Install & run

```bash
npm install
npm run server     # Express + orchestrator on :3001
npm run dev        # Vite UI on :5173 (proxies /api to :3001)
```

For production: `npm run build` then serve `dist/` from the same Express
process — it already statically serves the build.

### Run as a Mac background service

See `scripts/com.swingpro.server.plist` for a launchd template that
auto-starts the server on boot and restarts it on crash. Drop it in
`~/Library/LaunchAgents/` and `launchctl load` it.

---

## Repo layout

```
server.js                        Express + API routes
src/
  engine/                        scoring, risk, data fetching, providers
  intelligence/                  regime detector, earnings, reflection
  lifecycle/                     positionTracker, exitEngine
  scheduler/                     orchestrator, jobs, nseHolidays
  persistence/                   SQLite schema + repos
  components/                    React UI (tabs + cards + widgets)
docs/
  OUT_OF_SAMPLE_RESULTS.md       2025 validation findings
data/
  swingpro.db                    local SQLite (gitignored)
```

---

## Disclaimer

This is an educational and research platform. Nothing it produces is
financial advice. Trading the NSE involves the real possibility of
losing money. Paper-trade for at least a quarter before considering
real capital, and even then, size down and re-validate.

## License

MIT — © Arindam Chowdhury

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

## The scoring engine — what it evaluates

The engine combines a **10-factor 0–100 confidence score** with **3 hard
pre-rank gates** and a **5-point Varsity checklist** shown on every card.
This is the entire basis on which it shortlists or refuses a trade.

### A. The 10 weighted factors (0–100)

| # | Factor | Weight | Concrete signals checked |
| --- | --- | --- | --- |
| 1 | **Trend Alignment** | 13 | Price > EMA20 > EMA50; EMA200 stack; EMA20 + EMA50 slopes rising |
| 2 | **Momentum** | 15 | RSI(14) zone 40–65 (healthy bullish); MACD bullish + histogram rising; MACD fresh crossover |
| 3 | **Volume Profile** | 10 | RVOL > 1.2× 20d-avg (above-avg) or > 2.0× (spike); volume drying flagged |
| 4 | **Price Action** | 11 | Bollinger squeeze; horizontal breakout above resistance with volume |
| 5 | **Risk–Reward** | 12 | Target/stop ratio: 3.0×→12 pts, 2.5×→10, 2.0×→7, 1.5×→3, <1.5×→0 |
| 6 | **Psychology** | 9 | RSI > 75 penalty; dayChange > 5% penalty (FOMO guard); multi-signal confluence bonus |
| 7 | **Fundamentals** | 10 | Scraped from Screener.in: ROCE, ROE, debt/equity, revenue growth, profit margin, PE |
| 8 | **Market Context** | 10 | Nifty trend (bullish/bearish/neutral); market mood; regime detector output |
| 9 | **Candlestick Patterns** | 5 | Three White Soldiers, Morning Star, Bullish Engulfing, Hammer, Dragonfly Doji, Bullish Harami |
| 10 | **Market Structure + OBV** | 5 | Higher-Highs / Higher-Lows confirmed; OBV trend rising; OBV bullish divergence |

Total score must reach **≥ 50** to enter Pass 1 (strict). Below 50 a Pass-2
fallback fills remaining slots with the best-available, tagged as low
confidence.

### B. Hard pre-rank gates (every gate must pass)

| Gate | Rule | Source |
| --- | --- | --- |
| **R:R floor** | riskRewardRatio ≥ 1.5 | Varsity TA ch.11 |
| **Confidence floor** | totalScore ≥ 50 | Backtest-tuned (3yr × 198 stocks sweep) |
| **ADX trend-strength** | Trending setups (Trend Continuation, Breakout, MACD Crossover, Three White Soldiers) refused when ADX < 20. Mean-reversion setups refused when ADX > 30. | Varsity TA ch.20 |
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

- Trend Continuation / HH/HL Trend Continuation
- Breakout / Breakout + ADX Trend
- Three White Soldiers
- Morning Star Reversal / Engulfing at Support / Hammer at Support
- MACD Crossover
- OBV Bullish Divergence
- Pullback / RSI Reversal
- Bollinger Squeeze / Mean Reversion
- HH/HL Trend / Consolidation + Support
- Volume Surge
- (ETF variants of the above for the ETF universe)

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

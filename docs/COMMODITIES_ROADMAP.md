# SwingPro — Commodities Roadmap (Phase: Deferred Build)

**Status**: Spec only. **No code change in this iteration.** Build commences after the stocks paper-test phase validates (or invalidates) the equity engine — target window: ~2 weeks from current paper-test start.

---

## 1. Intent

Enable swing-trading of Indian commodity futures (MCX) during the evening session (17:00 – 23:30 IST), running on the same scoring engine, lifecycle, and orchestrator as stocks/ETFs — with commodity-specific guards (lot sizes, leverage math, expiry rollover, no-fundamentals model).

## 2. Why this is **not** a trivial extension of stocks/ETFs

| Aspect | Stocks/ETFs | Commodities |
|---|---|---|
| Instrument type | Cash equity | Futures (leveraged, expiring) |
| Contracts per symbol | One | Multiple (current month, next month, far month) |
| Lot size | 1 share | Fixed (GOLD = 100g, SILVER = 30kg, CRUDEOIL = 100bbl) |
| Leverage / margin | 100% cash | ~5-10% margin (10-20× implicit leverage) |
| Trading hours | 09:15–15:30 | 09:00–23:30 (incl evening session 17:00–23:30) |
| Price gaps | Rare beyond 2-3% | Routine 3-5% on US macro data |
| Fundamentals data | PE, ROE, ROCE | None applicable |
| Settlement | T+1 cash | Daily MTM with exchange + physical settlement near expiry |
| Correlations | Mostly with Nifty | Independent / global drivers (USD, US Fed, OPEC, China PMI) |

## 3. Tradeable universe (Phase-1)

15 contracts that have sufficient liquidity + retail accessibility:

### Bullion
| Symbol | Lot size | Tick | Approx margin per lot |
|---|---|---|---|
| GOLD | 100g | ₹1/g | ~₹65,000 |
| GOLDM | 100g (mini) | ₹1/g | ~₹38,000 |
| SILVER | 30kg | ₹1/kg | ~₹90,000 |
| SILVERM | 5kg (mini) | ₹1/kg | ~₹17,000 |

### Energy
| Symbol | Lot size | Tick | Approx margin per lot |
|---|---|---|---|
| CRUDEOIL | 100bbl | ₹1/bbl | ~₹45,000 |
| CRUDEOILM | 10bbl (mini) | ₹1/bbl | ~₹5,000 |
| NATURALGAS | 1250 mmBtu | ₹0.1/mmBtu | ~₹30,000 |

### Base Metals
| Symbol | Lot size | Tick | Approx margin per lot |
|---|---|---|---|
| COPPER | 2,500kg | ₹0.05/kg | ~₹40,000 |
| ZINC | 5,000kg | ₹0.05/kg | ~₹35,000 |
| LEAD | 5,000kg | ₹0.05/kg | ~₹25,000 |
| NICKEL | 1,500kg | ₹1/kg | ~₹55,000 |
| ALUMINIUM | 5,000kg | ₹0.05/kg | ~₹30,000 |

### Agri (day-session only — no evening)
| Symbol | Lot size | Tick |
|---|---|---|
| GUARSEED | 10MT | ₹1/qntl |
| CASTOR | 10MT | ₹0.5/qntl |
| MENTHAOIL | 360kg | ₹0.10/kg |

**Universe count: 15.** Phase-1 explicitly excludes thin contracts (KAPAS, RUBBER, BARLEY, etc.) and exotic micro-lots.

## 4. Data layer

### Angel One SmartAPI — MCX integration

- Same `smartapi-javascript` SDK we use for NSE
- `exchange='MCX'` parameter (vs `'NSE'`)
- Same `getCandleData` endpoint for historical
- Same `marketData` endpoint for LTP
- Token resolution uses the same `OpenAPIScripMaster.json` — filter `exch_seg='MCX'` instead of `'NSE'`

### Symbol-to-contract mapping

MCX contracts have monthly expiries. Symbol format on Angel One:
```
GOLD25NOVFUT   ← current month
GOLD25DECFUT   ← next month
GOLD26JANFUT   ← far month
```

**Rule**: always trade the contract with **highest open interest** (typically current month, switches to next month ~5 days before expiry).

### New file: `src/engine/commodityUniverse.js`
```js
export default [
  { base: 'GOLD',       fullName: 'Gold (1kg)', segment: 'bullion', lotSize: 1000, tick: 1, ... },
  { base: 'GOLDM',      fullName: 'Gold Mini',  segment: 'bullion', lotSize: 100,  tick: 1, ... },
  // ... 15 contracts
];
```

The runtime resolves `base + currentMonthExpiry` to the actual MCX symbol on each scan.

### New script: `scripts/buildMcxTokenMap.js`

Mirrors `buildAngelOneTokenMap.js` but filters for `exch_seg='MCX'` and resolves the **front-month contract** for each base symbol. Writes `data/mcx-tokens.json`. Re-runs monthly (cron) since contracts roll over.

## 5. Engine — adjusted for commodities

### Scoring weights (commodity variant — `scoringEngine-commodity.js` or option flag)

| Factor | Stock weight | Commodity weight | Reason |
|---|---|---|---|
| Trend (EMA stack) | 13 | **15** | More important — momentum dominates commodity moves |
| Momentum (RSI/MACD) | 15 | **17** | Same |
| Volume | 10 | **8** | Less predictive — MCX volume more event-driven |
| Price action | 11 | **12** | Breakouts dominate commodity moves |
| Risk:Reward | 12 | 12 | Same |
| Psychology (RSI extremes) | 9 | 9 | Same |
| **Fundamentals** | 10 | **0** | Not applicable |
| Market context (Nifty) | 10 | **8** | Less correlated |
| Candlestick patterns | 5 | **8** | More important for commodities |
| HH/HL structure + OBV | 5 | **11** | Critical for commodity trends |
| **Total** | 100 | **100** | |

### New context inputs (commodity-specific signal)

- **Dollar Index (DXY)** trend — direct inverse correlation with bullion
- **Crude USD price** — drives natural gas + petrochemicals
- **US Fed rate expectations** (proxy via VIX-X or just calendar)

These are optional v2 enhancements.

## 6. Risk engine — adjusted for commodities

### `commodityPositionSize()`

```js
function commodityPositionSize({
  contract,        // { base, lotSize, tick, marginPerLot }
  entryPrice,      // ₹/unit (g, bbl, kg)
  stopLoss,
  riskAmount,      // capital * 0.015 (1.5% default)
}) {
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  const riskPerLot  = riskPerUnit * contract.lotSize;
  const lots        = Math.floor(riskAmount / riskPerLot);
  if (lots < 1) return null;   // can't size to one full lot
  const capitalRequired = lots * contract.marginPerLot;  // not lots × notional
  return { lots, capitalRequired, riskPerLot, riskAmount: lots * riskPerLot };
}
```

**Critical difference from stocks**: `capitalRequired` is margin (5-10% of notional), not full notional. A single GOLD lot costs ₹65K in margin but has ₹6-7L notional exposure.

### Position-cap adjustments

- **Stocks**: ≤5 positions, ≤₹50K total deployed (notional = deployed)
- **ETFs**: ≤5 positions, ≤₹50K total deployed (notional = deployed)
- **Commodities**: ≤3 positions, ≤₹30K total **margin deployed** (notional up to ₹3L)

Commodity max-concurrent is lower because each position carries leveraged tail risk.

### Killswitch additions

- Trip if **margin utilization > 80%** (already partly covered via deploymentPct, but commodities measure differently)
- Trip if **single commodity position past 3% of capital in loss** (leveraged ≠ tighter stop %)

## 7. Scheduler — evening session jobs

Reuses the same `node-cron` pattern + IST timezone, with new job IDs:

```js
{
  id: 'pre-market-commodity',
  cron: '50 16 * * 1-5',          // 16:50 IST — 10 min before evening session opens
  description: 'Scan commodities, auto-track top picks for evening session',
  handler: () => jobPreMarketCommodity(ctx),
},
{
  id: 'mark-to-market-commodity',
  cron: '*/15 17-23 * * 1-5',     // every 15 min, evening session
  description: 'MTM commodities during evening session',
  handler: () => jobMarkToMarketCommodity(ctx),
},
{
  id: 'exit-cycle-commodity',
  cron: '*/30 17-23 * * 1-5',     // every 30 min, evening session
  description: 'Evaluate exit rules for commodity positions',
  handler: () => jobExitCycleCommodity(ctx),
},
{
  id: 'eod-snapshot-commodity',
  cron: '30 23 * * 1-5',          // 23:30 IST — end of evening session
  description: 'EOD commodities: final MTM + exit cycle + rollover check',
  handler: () => jobEodCommodity(ctx),
},
{
  id: 'rollover-monthly',
  cron: '0 9 25 * *',             // 25th of each month, 09:00 IST
  description: 'Rebuild MCX token map (front-month contract roll)',
  handler: () => jobRolloverMcxContracts(ctx),
},
```

### Open question: rollover handling

When a position is open and contract is < 3 days from expiry:
- Option A: auto-close at evening session close on T-3
- Option B: auto-roll (close current month + open next month)
- Option C: surface as warning, user decides manually

**Recommendation: Option A for v1** (auto-close T-3). Rollover adds complexity worth deferring to v2.

## 8. UI changes

### New mode in toggle

```
[ Stocks ] [ ETFs ] [ Commodities ]
   cyan    violet     amber
```

Add `commodities` as the third mode in App.jsx scanMode. Already wired in CSS (`--asset-commodity` exists).

### Dashboard

- Dashboard mode=commodities shows commodity holdings (filtered by `asset_class='commodity'`)
- TradeCard renders commodity-specific fields:
  - **Lot size + lots held** (e.g., "2 lots × 100g = 200g GOLD")
  - **Notional exposure** vs **margin deployed** clearly distinguished
  - **Contract expiry** (with days-to-expiry warning if < 7d)
  - **No fundamentals section** (replaced with "Macro Context": USD index, US 10Y yield)

### Day P&L widget

Already mode-aware. Just add commodity mode handling in `DailyPnLWidget.jsx`:
```js
const activeColor = activeClass === 'commodity' ? 'var(--asset-commodity)' : ...
```

### Today tab

Already mode-aware via `assetClass` param. New section appears automatically when commodities have picks.

### Backtests tab

Can already store commodity backtest runs via `asset_class` column on `backtest_runs`. CLI runner needs flag:
```bash
node scripts/runBacktest.js --universe commodity --start 2022-01-01 --end 2024-12-31
```

## 9. Backtesting commodities

Same engine architecture, different inputs:

- New universe loader: `historicalLoader` extended to fetch MCX candles
- New scoring weights flag: `--commodity-mode` switches to commodity weights
- New simulator: same logic but uses lot-size + margin math

### Open question: data availability

Angel One's historical MCX endpoint provides daily candles from ~2018. 6+ years is sufficient for a robust backtest. Verify by pulling one symbol (e.g., GOLD25NOVFUT) before committing to backtest scope.

## 10. Effort breakdown

| Layer | Files | Est. hours |
|---|---|---|
| Data: commodityUniverse + MCX token map + script | 3 new files | 1.5 |
| Engine: commodity scoring variant + indicators | 2 files | 1.5 |
| Risk: commodityPositionSize + leverage-aware guards | 1 file | 1 |
| Scheduler: 4-5 commodity jobs in jobs.js + orchestrator | 2 files | 2 |
| Server: extend endpoints for `assetClass='commodity'` | 1 file | 0.5 |
| Backtest: commodity scoring + lot-size simulator | 2 files | 2 |
| UI: third mode toggle + commodity TradeCard fields | 2 files | 1.5 |
| Test: sandbox + first real backtest | — | 2 |
| **Total** | **~13 files** | **~12 hours** (2 evenings) |

## 11. Pre-flight checklist (before build commences)

1. **Stocks paper test must validate** — 30 trades closed, win rate within 30-55%, expectancy positive
2. **Angel One MCX access verified** — pull a candle for `GOLD25NOVFUT` successfully
3. **Decide rollover policy** — Option A (auto-close T-3) is the recommended default
4. **Confirm capital allocation** — separate ₹30K bucket for commodities (or shared with stocks?)
5. **Backtest commodity engine first** — get 2 years of MCX data + run sweep before live paper

## 12. What this commits us to NOT do (anti-goals)

- **No intraday commodity scalping** — engine is designed for swing (3-15 day holds)
- **No agri commodities trading** at launch — too thin, too event-driven (cyclone, monsoon)
- **No options on commodities** — engine doesn't price options
- **No physical delivery** — auto-close all positions 3 days before expiry to avoid delivery obligation
- **No commodity-equity arbitrage** — separate paper portfolios

## 13. Decision points to revisit at build start

- **Should commodity capital be shared with stocks (₹50K total) or separate (₹30K dedicated)?**
  - Shared = simpler, but stocks could starve commodity allocation
  - Separate = cleaner risk segmentation
  - Recommendation: separate ₹30K bucket; commodities never touch equity capital

- **Use existing single-position 8% killswitch or commodity-specific 4%?**
  - Commodities move faster; 8% may be too late
  - Recommendation: 4% per-position catastrophic for commodities

- **Track all commodities as one bucket, or per-segment (bullion / energy / metals)?**
  - All-bucket simpler; per-segment catches concentration risk better
  - Recommendation: all-bucket for v1, per-segment in v2

---

## Sign-off conditions to start building this

1. ✅ Schema supports `asset_class='commodity'` (done in current session's ETF parity work)
2. ⏳ Stocks forward test produced statistically meaningful read (need ≥10 closed trades)
3. ⏳ ETF forward test produces baseline read (after ETF auto-pilot enabled and runs ~5 days)
4. ⏳ User approves the architectural decisions in §13

Until all four are checked, commodity build remains on this page only.

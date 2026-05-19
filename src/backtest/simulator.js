/**
 * Single-trade simulator.
 *
 * Given an entry signal at day D and forward OHLCV from D+1 onwards,
 * walks the price action day-by-day and determines the exit:
 *  - stop hit  → exit at stop price
 *  - target hit → exit at target price
 *  - both hit same day → assume stop hit first (conservative)
 *  - time stop → exit at close of day D + maxHoldingDays
 *
 * NEVER uses look-ahead data: only days strictly after entry are read.
 */

// Cost model — NSE delivery (cash) trades. Each value is one-sided in
// basis points (1 bp = 0.01%). Defaults match a small-account retail
// trader using a discount broker (Zerodha-equivalent) in 2024-26.
//
//   slippageBps   20    spread + impact, each side       → 0.40% round-trip
//   brokerageBps  10    brokerage notional, each side    → ~0.20% round-trip
//                       (effective; formula multiplies both notionals)
//   sttBps        10    Securities Transaction Tax, SELL only (NSE delivery)
//                                                        → 0.10% one-time
//   stampBps     1.5    stamp duty, BUY only             → ~0.0075% round-trip
//
// Total realistic round-trip cost ≈ 0.71% (slippage + brokerage + STT + stamp).
// Pre-M5.5 the simulator was modelling ~0.60% (no STT, no stamp). The new
// baseline lowers reported expectancy by ~5-10 bps but matches real NSE
// trading costs for a small account. CLI flags let the user dial these
// per-run to simulate institutional vs retail vs commission-free regimes.
const DEFAULT_OPTS = {
  maxHoldingDays: 25,
  slippageBps:    20,
  brokerageBps:   10,
  sttBps:         10,    // 0.10% NSE delivery STT on sell side (10 bp = 0.10%)
  stampBps:      1.5,    // 0.015% stamp duty on buy side
};

/**
 * Simulate one trade.
 *
 * @param {object} entry — { entryDate, entryPrice, stopLoss, targetPrice, quantity }
 * @param {Array<{date,open,high,low,close,volume}>} futureCandles — quotes strictly AFTER entry day
 * @param {object} [opts]
 * @returns {object} — exit details
 */
export function simulateTrade(entry, futureCandles, opts = {}) {
  const O = { ...DEFAULT_OPTS, ...opts };

  const entryPrice  = entry.entryPrice * (1 + O.slippageBps / 10000);
  const stop        = entry.stopLoss;
  const target      = entry.targetPrice;
  const qty         = entry.quantity || 1;

  // Hard guards: bad inputs → zero-trade outcome
  if (!Number.isFinite(stop) || !Number.isFinite(target) || stop >= entryPrice || target <= entryPrice) {
    return {
      exitDate:    entry.entryDate,
      exitPrice:   entryPrice,
      exitReason:  'invalid',
      holdingDays: 0,
      pnl:         0,
      pnlPct:      0,
      mae:         0,
      mfe:         0,
    };
  }

  let mae = 0;            // max adverse excursion — worst drawdown during trade
  let mfe = 0;            // max favorable excursion — best paper profit
  const initialRisk = entryPrice - stop;

  const horizon = Math.min(futureCandles.length, O.maxHoldingDays);

  for (let i = 0; i < horizon; i++) {
    const c = futureCandles[i];
    const dayLow  = c.low;
    const dayHigh = c.high;

    // Track MAE / MFE
    const adverseR  = (entryPrice - dayLow)  / initialRisk;
    const favorR    = (dayHigh   - entryPrice) / initialRisk;
    if (adverseR > mae) mae = adverseR;
    if (favorR   > mfe) mfe = favorR;

    // Gap-down through stop: exit at open
    if (c.open <= stop) {
      return finishTrade(entry, c, c.open, 'stop_gap', i + 1, mae, mfe, qty, O);
    }
    // Gap-up through target: exit at open (rare, but capture it)
    if (c.open >= target) {
      return finishTrade(entry, c, c.open, 'target_gap', i + 1, mae, mfe, qty, O);
    }
    // Stop hit during day (assume worst-case fill at stop)
    if (dayLow <= stop) {
      return finishTrade(entry, c, stop, 'stop', i + 1, mae, mfe, qty, O);
    }
    // Target hit during day
    if (dayHigh >= target) {
      return finishTrade(entry, c, target, 'target', i + 1, mae, mfe, qty, O);
    }
  }

  // Time stop: exit at close of last available day
  if (horizon > 0) {
    const lastCandle = futureCandles[horizon - 1];
    return finishTrade(entry, lastCandle, lastCandle.close, 'time', horizon, mae, mfe, qty, O);
  }

  // No future data at all → return as open (skipped)
  return {
    exitDate:    entry.entryDate,
    exitPrice:   entryPrice,
    exitReason:  'no_data',
    holdingDays: 0,
    pnl:         0,
    pnlPct:      0,
    mae,
    mfe,
  };
}

function finishTrade(entry, exitCandle, rawExitPrice, reason, days, mae, mfe, qty, O) {
  // Slippage on exit. (Entry slippage is intentionally not applied to P&L —
  // see DEFAULT_OPTS comment. The local slippage-adjusted entry in the
  // outer scope is used only for MAE/MFE tracking.)
  const exitPrice = rawExitPrice * (1 - O.slippageBps / 10000);

  // Gross trading P&L
  const buyNotional  = entry.entryPrice * qty;
  const sellNotional = exitPrice * qty;
  const grossPnl     = sellNotional - buyNotional;

  // Cost breakdown — explicit, easy to audit per-trade
  const brokerage = (buyNotional + sellNotional) * (O.brokerageBps / 10000);
  const stt       = sellNotional               * (O.sttBps        / 10000);
  const stamp     = buyNotional                * (O.stampBps      / 10000);
  const totalCost = brokerage + stt + stamp;

  const netPnl    = grossPnl - totalCost;
  // pnlPct kept GROSS for historical comparability across all prior runs
  // (Run #17, OUT_OF_SAMPLE_RESULTS.md, etc — those numbers were all gross).
  // pnlPctNet is the new honest net-of-costs percentage; downstream metrics
  // can opt into it when ready.
  const pnlPct    = buyNotional > 0 ? ((exitPrice - entry.entryPrice) / entry.entryPrice) * 100 : 0;
  const pnlPctNet = buyNotional > 0 ? (netPnl / buyNotional) * 100 : 0;

  const initialRisk = entry.entryPrice - entry.stopLoss;
  const rrRealized  = initialRisk > 0 ? (exitPrice - entry.entryPrice) / initialRisk : 0;

  return {
    exitDate:     exitCandle.date instanceof Date ? exitCandle.date.toISOString() : exitCandle.date,
    exitPrice:    Math.round(exitPrice * 100) / 100,
    exitReason:   reason,
    holdingDays:  days,
    pnl:          Math.round(netPnl * 100) / 100,
    pnlPct:       Math.round(pnlPct    * 100) / 100,   // gross — legacy
    pnlPctNet:    Math.round(pnlPctNet * 100) / 100,   // net of costs
    rrRealized:   Math.round(rrRealized * 100) / 100,
    mae:          Math.round(mae * 100) / 100,   // expressed in R-multiples
    mfe:          Math.round(mfe * 100) / 100,
    // Cost transparency — surfaces in per-trade rows so the user can audit
    costBreakdown: {
      brokerage: Math.round(brokerage * 100) / 100,
      stt:       Math.round(stt       * 100) / 100,
      stamp:     Math.round(stamp     * 100) / 100,
      total:     Math.round(totalCost * 100) / 100,
    },
  };
}

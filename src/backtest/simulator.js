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

const DEFAULT_OPTS = {
  maxHoldingDays: 25,    // hard time stop
  slippageBps:    20,    // 0.2% slippage on entry + exit
  brokerageBps:   10,    // round-trip ~0.1% (delivery cost on small accounts)
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
  // Slippage on exit, plus round-trip brokerage
  const exitPrice = rawExitPrice * (1 - O.slippageBps / 10000);
  const grossPnl  = (exitPrice - entry.entryPrice) * qty;
  const cost      = (entry.entryPrice + exitPrice) * qty * (O.brokerageBps / 10000);
  const netPnl    = grossPnl - cost;
  const pnlPct    = ((exitPrice - entry.entryPrice) / entry.entryPrice) * 100;

  const initialRisk = entry.entryPrice - entry.stopLoss;
  const rrRealized  = initialRisk > 0 ? (exitPrice - entry.entryPrice) / initialRisk : 0;

  return {
    exitDate:     exitCandle.date instanceof Date ? exitCandle.date.toISOString() : exitCandle.date,
    exitPrice:    Math.round(exitPrice * 100) / 100,
    exitReason:   reason,
    holdingDays:  days,
    pnl:          Math.round(netPnl * 100) / 100,
    pnlPct:       Math.round(pnlPct * 100) / 100,
    rrRealized:   Math.round(rrRealized * 100) / 100,
    mae:          Math.round(mae * 100) / 100,   // expressed in R-multiples
    mfe:          Math.round(mfe * 100) / 100,
  };
}

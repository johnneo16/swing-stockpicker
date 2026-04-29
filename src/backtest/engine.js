/**
 * Walk-forward backtesting engine.
 *
 * For each trading day D in [startDate, endDate]:
 *   1. For each stock in universe, build OHLCV history up to and including D.
 *   2. Run the production scoreStock() against that history.
 *   3. If score ≥ threshold AND a trade isn't already open in this stock:
 *        - Enter at next day's open (D+1)
 *        - Simulate forward using simulator.simulateTrade()
 *        - Record the outcome.
 *   4. Sector / portfolio caps enforced by tracking concurrent open trades.
 *
 * Output: array of completed trade records + computed metrics.
 *
 * Strict no-look-ahead: scoreStock only sees `quotes` slice up to day D.
 */

import { loadHistoricalBulk } from './historicalLoader.js';
import { simulateTrade }     from './simulator.js';
import { computeMetrics }    from './metrics.js';
import { scoreStock }         from '../engine/scoringEngine.js';

const DEFAULT_CONFIG = {
  startDate:        '2023-01-01',
  endDate:          '2024-12-31',
  capital:          50000,
  scoreThreshold:   60,        // only enter when confidence ≥ this
  minRR:            1.5,
  maxConcurrent:    5,
  maxPerSector:     3,
  maxHoldingDays:   25,
  rebalanceEvery:   1,         // re-scan every N trading days (1 = daily)
  warmupDays:       80,        // need ~80 bars before scoring engine works
  slippageBps:      20,
  brokerageBps:     10,
  // Force-include even low-confidence picks? (mirror Pass 2 of live engine)
  includeLowConf:   false,
};

/**
 * @param {Array<{symbol,sector,name}>} universe
 * @param {object} config
 * @param {Function} [progressFn] — called with progress updates
 */
export async function runBacktest(universe, config = {}, progressFn = null) {
  const C = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();

  // ─────────────────────────────────────────────────────────────
  // 1. BULK LOAD all historical data (uses disk cache if present)
  // ─────────────────────────────────────────────────────────────
  const fetchStart = isoDateOffset(C.startDate, -(C.warmupDays + 30));
  const fetchEnd   = C.endDate;

  if (progressFn) progressFn({ phase: 'loading', symbols: universe.length });
  console.log(`\n📊 Loading data for ${universe.length} symbols (${fetchStart} → ${fetchEnd})...`);

  const dataMap = await loadHistoricalBulk(
    universe.map(s => s.symbol),
    fetchStart,
    fetchEnd,
    { concurrency: 3, delayMs: 350 },
  );

  // Build symbol → metadata lookup
  const meta = new Map(universe.map(s => [s.symbol, s]));

  // Drop symbols we couldn't fetch
  const tradeable = universe.filter(s => {
    const candles = dataMap.get(s.symbol);
    return candles && candles.length >= C.warmupDays + 10;
  });
  console.log(`  ✓ Tradeable: ${tradeable.length}/${universe.length}`);

  // ─────────────────────────────────────────────────────────────
  // 2. Build a master timeline (use Nifty/first stock as date axis)
  // ─────────────────────────────────────────────────────────────
  const masterDates = buildMasterTimeline(dataMap, tradeable, C.startDate, C.endDate);
  console.log(`  ✓ Trading days in window: ${masterDates.length}`);

  // ─────────────────────────────────────────────────────────────
  // 3. WALK FORWARD
  // ─────────────────────────────────────────────────────────────
  const completedTrades = [];
  const openTrades      = new Map();    // symbol → { entry, ... } (only one per symbol)
  let scanCount = 0;

  for (let dIdx = 0; dIdx < masterDates.length; dIdx++) {
    const today = masterDates[dIdx];

    // ── Process exits: simulator already computed exit date at open time,
    //    so we just check whether that date is today-or-earlier.
    const todayMs = new Date(today).getTime();
    for (const [sym, openT] of openTrades) {
      if (!openT._simExitDateMs || openT._simExitDateMs <= todayMs) {
        completedTrades.push({ ...openT, ...openT._simResult, symbol: sym });
        openTrades.delete(sym);
      }
    }

    // ── Skip if not on rebalance day
    if (dIdx % C.rebalanceEvery !== 0) continue;
    if (dIdx < C.warmupDays) continue;

    // ── Scan: score every tradeable stock as of today
    scanCount++;
    const candidates = [];

    for (const stock of tradeable) {
      if (openTrades.has(stock.symbol)) continue;            // already in trade
      if (openTrades.size >= C.maxConcurrent) break;          // portfolio full

      const candles = dataMap.get(stock.symbol);
      const sliceUpToToday = candlesUpTo(candles, today);
      if (sliceUpToToday.length < C.warmupDays) continue;

      // Build the same shape scoreStock expects
      const last = sliceUpToToday[sliceUpToToday.length - 1];
      const prev = sliceUpToToday[sliceUpToToday.length - 2] || last;
      const stockData = {
        symbol:        stock.symbol,
        name:          stock.name,
        sector:        stock.sector,
        quotes:        sliceUpToToday,
        currentPrice:  last.close,
        previousClose: prev.close,
        dayChange:     prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
        currentVolume: last.volume,
        dayHigh:       last.high,
        dayLow:        last.low,
        fundamentals:  null,   // not used in pure-technical backtest
      };

      let scored;
      try {
        scored = scoreStock(stockData, null, C.capital);
      } catch (_) { continue; }
      if (!scored) continue;

      candidates.push({ stock, scored });
    }

    // ── Rank & filter
    candidates.sort((a, b) => b.scored.confidenceScore - a.scored.confidenceScore);

    // Sector concentration tracking
    const sectorOpen = sectorCounts(openTrades, meta);

    for (const { stock, scored } of candidates) {
      if (openTrades.size >= C.maxConcurrent) break;
      if (scored.confidenceScore < C.scoreThreshold && !C.includeLowConf) continue;
      if (scored.riskRewardRatio < C.minRR) continue;
      if ((sectorOpen[stock.sector] || 0) >= C.maxPerSector) continue;

      // Entry tomorrow at open
      const futureCandles = candlesAfter(dataMap.get(stock.symbol), today);
      if (futureCandles.length === 0) continue;

      const entryCandle = futureCandles[0];
      const entryPrice  = entryCandle.open;

      // Recompute position size on the actual entry price
      const stop   = scored.stopLoss;
      const target = scored.targetPrice;
      if (stop >= entryPrice || target <= entryPrice) continue;

      const riskPerShare = entryPrice - stop;
      const riskAmount   = C.capital * 0.015;     // 1.5% per trade
      const maxQty       = Math.floor((C.capital * 0.20) / entryPrice);
      const qty          = Math.min(Math.floor(riskAmount / riskPerShare), maxQty);
      if (qty <= 0) continue;

      const trade = {
        symbol:       stock.symbol,
        sector:       stock.sector,
        setupType:    scored.setupType,
        entryDate:    entryCandle.date instanceof Date ? entryCandle.date.toISOString() : entryCandle.date,
        entryPrice:   Math.round(entryPrice * 100) / 100,
        stopLoss:     stop,
        targetPrice:  target,
        quantity:     qty,
        confidence:   scored.confidenceScore,
        rrPlanned:    scored.riskRewardRatio,
        estimatedDays: scored.estimatedDays,
      };

      // Simulate the trade ONCE at open — store result + exit date for fast lookup
      const futureSlice = futureCandles.slice(1, C.maxHoldingDays + 1); // skip entry day itself
      trade._simResult = simulateTrade(trade, futureSlice, {
        maxHoldingDays: C.maxHoldingDays,
        slippageBps:    C.slippageBps,
        brokerageBps:   C.brokerageBps,
      });
      trade._simExitDateMs = new Date(trade._simResult.exitDate).getTime();

      openTrades.set(stock.symbol, trade);
      sectorOpen[stock.sector] = (sectorOpen[stock.sector] || 0) + 1;

      if (progressFn && completedTrades.length % 25 === 0) {
        progressFn({ phase: 'scanning', day: today, openCount: openTrades.size, completed: completedTrades.length });
      }
    }
  }

  // ── Force-close any still-open trades at end of window using their pre-computed sim
  for (const [sym, openT] of openTrades) {
    completedTrades.push({ ...openT, ...openT._simResult, symbol: sym });
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n  ✓ Backtest complete in ${elapsed}s. ${completedTrades.length} trades closed.`);

  // Strip internal _sim* fields (don't persist them to DB)
  for (const t of completedTrades) {
    delete t._simResult;
    delete t._simExitDateMs;
  }

  // ─────────────────────────────────────────────────────────────
  // 4. METRICS
  // ─────────────────────────────────────────────────────────────
  const metrics = computeMetrics(completedTrades, C.capital);

  return {
    config: C,
    universe: tradeable.length,
    scanCount,
    elapsedSec: elapsed,
    trades: completedTrades,
    metrics,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function candlesUpTo(candles, isoDate) {
  const cutoff = new Date(isoDate).getTime();
  return candles.filter(c => new Date(c.date).getTime() <= cutoff);
}

function candlesAfter(candles, isoDate, max = 1000) {
  const cutoff = new Date(isoDate).getTime();
  return candles.filter(c => new Date(c.date).getTime() > cutoff).slice(0, max);
}

function isoDateOffset(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildMasterTimeline(dataMap, universe, startDate, endDate) {
  // Merge all unique trading dates that appear in the universe within the window
  const startMs = new Date(startDate).getTime();
  const endMs   = new Date(endDate).getTime();
  const set = new Set();
  for (const s of universe) {
    const candles = dataMap.get(s.symbol);
    if (!candles) continue;
    for (const c of candles) {
      const t = new Date(c.date).getTime();
      if (t >= startMs && t <= endMs) {
        set.add(new Date(c.date).toISOString().slice(0, 10));
      }
    }
  }
  return Array.from(set).sort();
}

function sectorCounts(openTrades, meta) {
  const counts = {};
  for (const sym of openTrades.keys()) {
    const stock = meta.get(sym);
    if (stock) counts[stock.sector] = (counts[stock.sector] || 0) + 1;
  }
  return counts;
}

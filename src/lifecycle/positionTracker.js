/**
 * Position Tracker
 *
 * Manages the lifecycle of open trades:
 *  - Opens a paper/live trade in the DB on entry
 *  - Marks-to-market every position with the latest LTP
 *  - Tracks running max-favorable-excursion for trailing stops
 *  - Surfaces summary state for the UI/API
 *
 * Pure persistence + math. The exit *decision* logic lives in exitEngine.js.
 */

import { tradesRepo, positionsRepo } from '../persistence/db.js';
import { fetchAngelOneLTP, isAngelOneConfigured } from '../engine/angelOneProvider.js';
import { CONFIG } from '../engine/riskEngine.js';
import yahooFinance from 'yahoo-finance2';

const USE_ANGELONE = isAngelOneConfigured();

/**
 * Open a new tracked position from a scored trade.
 *
 * Layer-2 defense: even if a caller bypasses the orchestrator's filters
 * (manual API call, future automation, test code), enforces:
 *   - MAX_CONCURRENT_TRADES cap
 *   - cash availability with CASH_RESERVE_PERCENT held back
 *   - skipTradingGuards opt-out flag for legitimate special-case use
 *
 * Idempotent: if a position is already open in this symbol+mode, returns existing.
 *
 * Throws on guard violation so callers can record the reason (orchestrator
 * does this) rather than silently corrupting portfolio state.
 *
 * @param {object} scoredTrade — must have symbol, entryPrice, stopLoss,
 *                               targetPrice, quantity, capitalRequired, riskAmount
 * @param {string} [mode='paper']
 * @param {object} [opts]
 *   - totalCapital: number, default 50000 — used for cash-availability math
 *   - skipGuards: bool, default false — bypass guards (use only for tests/migrations)
 */
export function openPosition(scoredTrade, mode = 'paper', opts = {}) {
  const existing = tradesRepo.getOpenBySymbol(scoredTrade.symbol, mode);
  if (existing) return existing;

  const totalCapital = opts.totalCapital || CONFIG.TOTAL_CAPITAL;
  const skipGuards   = opts.skipGuards === true;

  // ── Layer-2 defense (skippable for migrations / tests) ──────────────────
  if (!skipGuards) {
    const open = tradesRepo.getOpen(mode);

    // Guard 1: hard cap on concurrent positions
    if (open.length >= CONFIG.MAX_CONCURRENT_TRADES) {
      throw new Error(
        `[openPosition guard] Portfolio at ${open.length}/${CONFIG.MAX_CONCURRENT_TRADES}-position cap. ` +
        `Refusing to open ${scoredTrade.symbol}.`
      );
    }

    // Guard 2: cash availability (keep CASH_RESERVE_PERCENT free)
    const deployed     = open.reduce((sum, t) => sum + (t.capital || 0), 0);
    const cashRemaining = totalCapital - deployed;
    const minReserve   = totalCapital * CONFIG.CASH_RESERVE_PERCENT;
    const deployable   = cashRemaining - minReserve;
    const need         = scoredTrade.capitalRequired || 0;

    if (need > deployable) {
      throw new Error(
        `[openPosition guard] Insufficient capital for ${scoredTrade.symbol}: ` +
        `need ₹${need}, only ₹${Math.round(deployable)} deployable ` +
        `(cash ₹${Math.round(cashRemaining)} − ${CONFIG.CASH_RESERVE_PERCENT * 100}% reserve ₹${Math.round(minReserve)}).`
      );
    }
  }

  const tradeId = tradesRepo.open({
    symbol:           scoredTrade.symbol,
    name:             scoredTrade.name,
    sector:           scoredTrade.sector,
    setupType:        scoredTrade.setupType,
    mode,
    entryDate:        new Date().toISOString(),
    entryPrice:       scoredTrade.entryPrice,
    stopLoss:         scoredTrade.stopLoss,
    targetPrice:      scoredTrade.targetPrice,
    quantity:         scoredTrade.quantity,
    capitalRequired:  scoredTrade.capitalRequired,
    riskAmount:       scoredTrade.riskAmount,
    confidenceScore:  scoredTrade.confidenceScore,
    riskRewardRatio:  scoredTrade.riskRewardRatio,
    estimatedDays:    scoredTrade.estimatedDays,
    metadata: {
      executionStrategy: scoredTrade.executionStrategy,
      whyThisWorks:      scoredTrade.whyThisWorks,
      whyThisCanFail:    scoredTrade.whyThisCanFail,
    },
  });

  // Initialize position state
  positionsRepo.upsert({
    tradeId,
    lastPrice:      scoredTrade.entryPrice,
    lastPriceAt:    new Date().toISOString(),
    unrealizedPnl:  0,
    unrealizedPct:  0,
    highestClose:   scoredTrade.entryPrice,
    trailActive:    false,
    beMoved:        false,
    partialTaken:   false,
  });

  return tradesRepo.getById(tradeId);
}

/**
 * Close a position (called by exit engine or manual override).
 */
export function closePosition(tradeId, exitReason, exitPrice, exitDate = null) {
  const trade = tradesRepo.getById(tradeId);
  if (!trade || trade.status !== 'open') return null;
  const result = tradesRepo.close(tradeId, {
    exitDate:   exitDate || new Date().toISOString(),
    exitPrice,
    exitReason,
    entryPrice: trade.entry_price,
    quantity:   trade.quantity,
    entryDate:  trade.entry_date,
  });
  return { trade, result };
}

/**
 * Fetch latest price for a symbol (Angel One LTP first, Yahoo fallback).
 * Returns { price, source, fetchedAt } or null.
 */
export async function fetchLastPrice(symbol) {
  if (USE_ANGELONE) {
    try {
      const ltp = await fetchAngelOneLTP(symbol);
      if (ltp?.currentPrice) {
        return { price: ltp.currentPrice, source: 'angelone', fetchedAt: new Date().toISOString() };
      }
    } catch (_) { /* fall through */ }
  }
  try {
    const q = await yahooFinance.quote(`${symbol}.NS`);
    if (q?.regularMarketPrice) {
      return { price: q.regularMarketPrice, source: 'yahoo', fetchedAt: new Date().toISOString() };
    }
  } catch (_) {}
  return null;
}

/**
 * Mark-to-market every open trade in the given mode.
 * Returns array of position summaries.
 */
export async function markAllToMarket(mode = 'paper') {
  const open = tradesRepo.getOpen(mode);
  if (open.length === 0) return [];

  const summaries = [];
  for (const t of open) {
    const lp = await fetchLastPrice(t.symbol);
    if (!lp) {
      summaries.push({ ...summarize(t, null), error: 'price_fetch_failed' });
      continue;
    }
    const pos = positionsRepo.get(t.trade_id || t.id) || {};
    const newHighest = Math.max(pos.highest_close || t.entry_price, lp.price);
    const unrealizedPnl = (lp.price - t.entry_price) * t.quantity;
    const unrealizedPct = ((lp.price - t.entry_price) / t.entry_price) * 100;

    positionsRepo.upsert({
      tradeId:       t.id,
      lastPrice:     lp.price,
      lastPriceAt:   lp.fetchedAt,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      unrealizedPct: Math.round(unrealizedPct * 100) / 100,
      highestClose:  newHighest,
      trailActive:   pos.trail_active === 1,
      beMoved:       pos.be_moved === 1,
      partialTaken:  pos.partial_taken === 1,
    });

    summaries.push(summarize(t, { ...pos, last_price: lp.price, highest_close: newHighest, unrealized_pnl: unrealizedPnl, unrealized_pct: unrealizedPct }));
  }
  return summaries;
}

function summarize(trade, position) {
  const lp = position?.last_price ?? trade.entry_price;
  const unrealizedPnl = position?.unrealized_pnl ?? 0;
  const unrealizedPct = position?.unrealized_pct ?? 0;
  const initialRisk = trade.entry_price - trade.initial_stop;
  const inProfit = unrealizedPnl > 0;
  const distanceToStop   = lp > 0 ? ((lp - trade.current_stop) / lp) * 100 : null;
  const distanceToTarget = lp > 0 ? ((trade.target_price - lp) / lp) * 100 : null;
  const rMultiple = initialRisk > 0 ? (lp - trade.entry_price) / initialRisk : null;
  const heldDays = Math.max(0, Math.round((Date.now() - new Date(trade.entry_date).getTime()) / 86400000));

  return {
    id:               trade.id,
    symbol:           trade.symbol,
    name:             trade.name,
    sector:           trade.sector,
    setupType:        trade.setup_type,
    entryDate:        trade.entry_date,
    entryPrice:       trade.entry_price,
    initialStop:      trade.initial_stop,
    currentStop:      trade.current_stop,
    target:           trade.target_price,
    quantity:         trade.quantity,
    capital:          trade.capital,
    riskAmount:       trade.risk_amount,
    confidence:       trade.confidence,

    lastPrice:        lp,
    unrealizedPnl:    Math.round(unrealizedPnl * 100) / 100,
    unrealizedPct:    Math.round(unrealizedPct * 100) / 100,
    rMultiple:        rMultiple != null ? Math.round(rMultiple * 100) / 100 : null,
    distanceToStopPct: distanceToStop != null ? Math.round(distanceToStop * 100) / 100 : null,
    distanceToTargetPct: distanceToTarget != null ? Math.round(distanceToTarget * 100) / 100 : null,
    heldDays,
    estimatedDays:    trade.est_days,
    inProfit,

    trailActive:      position?.trail_active === 1,
    beMoved:          position?.be_moved === 1,
    partialTaken:     position?.partial_taken === 1,
  };
}

/**
 * Get all open positions (already marked-to-market) without fetching prices.
 * Use after `markAllToMarket` for a cheap UI read.
 */
export function listOpenPositions(mode = 'paper') {
  const open = tradesRepo.getOpen(mode);
  return open.map(t => summarize(t, positionsRepo.get(t.id)));
}

/**
 * Aggregate portfolio view.
 */
export function portfolioSummary(mode = 'paper', totalCapital = 50000) {
  const positions = listOpenPositions(mode);
  const deployed       = positions.reduce((s, p) => s + (p.capital || 0), 0);
  const unrealizedPnl  = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
  const openRisk       = positions.reduce((s, p) => {
    if (p.lastPrice > p.currentStop) {
      return s + (p.lastPrice - p.currentStop) * p.quantity;
    }
    return s; // already past stop — not really at risk vs current
  }, 0);
  const initialRiskExposure = positions.reduce((s, p) => s + (p.riskAmount || 0), 0);

  // Simple correlation proxy: sector concentration
  const sectorMap = {};
  for (const p of positions) sectorMap[p.sector] = (sectorMap[p.sector] || 0) + 1;
  const maxSectorCount = Math.max(0, ...Object.values(sectorMap));

  return {
    totalCapital,
    capitalDeployed:  Math.round(deployed),
    cashRemaining:    Math.round(totalCapital - deployed),
    deploymentPct:    Math.round((deployed / totalCapital) * 10000) / 100,
    unrealizedPnl:    Math.round(unrealizedPnl),
    unrealizedPct:    Math.round((unrealizedPnl / totalCapital) * 10000) / 100,
    openRisk:         Math.round(openRisk),
    initialRiskPct:   Math.round((initialRiskExposure / totalCapital) * 10000) / 100,
    activePositions:  positions.length,
    sectorDistribution: sectorMap,
    maxSectorCount,
    overconcentratedSector: maxSectorCount >= 3 ? Object.entries(sectorMap).find(([_, c]) => c >= 3)?.[0] : null,
  };
}

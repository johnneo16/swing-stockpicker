/**
 * Exit Engine
 *
 * Decides what to do with each open position based on current price action:
 *   1. Hard stop hit  → CLOSE at stop
 *   2. Target hit     → CLOSE at target
 *   3. Time stop      → CLOSE at LTP if held >= maxHoldingDays
 *   4. Move to BE     → if at +1R, raise stop to entry price
 *   5. Trail stop     → if at +2R or higher, trail by ATR or % below high
 *   6. Partial exit   → if at +1.5R and not already partial-taken, scale 50%
 *
 * Each rule emits an "action" object that describes the recommended change.
 * The orchestrator decides whether to apply (paper) or surface to user (live).
 */

import { tradesRepo, positionsRepo, db } from '../persistence/db.js';
import { closePosition, fetchLastPrice, listOpenPositions } from './positionTracker.js';

// Prepared statement for partial exits (avoids re-preparing on every call)
const partialExitStmt = db.prepare(
  `UPDATE trades SET quantity = ?, partial_exits = ?, updated_at = datetime('now') WHERE id = ?`
);

const DEFAULT_RULES = {
  maxHoldingDays:    25,
  beTriggerR:        1.0,    // move stop to BE at +1R
  partialTriggerR:   1.5,    // book 50% at +1.5R
  trailTriggerR:     2.0,    // start trailing at +2R
  trailATRMult:      2.0,    // trail by 2 × ATR — fallback when no ATR: 5%
  trailPctFallback:  0.05,   // 5% trail
  panicExitOnDayLoss: 0.07,  // close intraday if loss > 7% from entry
};

/**
 * Evaluate one position against rules and return a single action.
 *
 * @returns {object} action — one of:
 *   { type: 'hold' }
 *   { type: 'close', reason, exitPrice }
 *   { type: 'move_stop', newStop, reason }
 *   { type: 'partial_exit', qty, exitPrice, reason }
 */
export function evaluateExit(position, rules = {}) {
  const R = { ...DEFAULT_RULES, ...rules };

  const {
    id, symbol, entryPrice, initialStop, currentStop, target,
    quantity, lastPrice, heldDays, beMoved, partialTaken, rMultiple,
  } = position;

  if (!lastPrice || !currentStop || !target) return { type: 'hold', reason: 'incomplete_state' };

  // ── 1. Hard stop hit ──────────────────────────────────────────
  if (lastPrice <= currentStop) {
    return { type: 'close', reason: 'stop_hit', exitPrice: lastPrice, tradeId: id };
  }

  // ── 2. Target hit ─────────────────────────────────────────────
  if (lastPrice >= target) {
    return { type: 'close', reason: 'target_hit', exitPrice: lastPrice, tradeId: id };
  }

  // ── 3. Time stop ──────────────────────────────────────────────
  if (heldDays >= R.maxHoldingDays) {
    return { type: 'close', reason: 'time_stop', exitPrice: lastPrice, tradeId: id };
  }

  // ── 4. Panic exit on huge intraday loss (rare gap-down survival) ──
  const lossPct = (entryPrice - lastPrice) / entryPrice;
  if (lossPct > R.panicExitOnDayLoss) {
    return { type: 'close', reason: 'panic_loss', exitPrice: lastPrice, tradeId: id };
  }

  // ── 5. Profit-management ladder (mutually exclusive, applied in priority order) ──
  // 5a. Trailing stop (highest priority — once trailing, ignore BE/partial logic)
  if (rMultiple != null && rMultiple >= R.trailTriggerR) {
    const trailDistance = lastPrice * R.trailPctFallback;
    const newStop = Math.max(lastPrice - trailDistance, currentStop);
    if (newStop > currentStop * 1.001) {
      return { type: 'move_stop', newStop, reason: 'trail', tradeId: id };
    }
  }

  // 5b. Partial exit at +1.5R (once)
  if (rMultiple != null && rMultiple >= R.partialTriggerR && !partialTaken && quantity >= 2) {
    const partialQty = Math.floor(quantity / 2);
    return { type: 'partial_exit', qty: partialQty, exitPrice: lastPrice, reason: 'partial_50pct', tradeId: id };
  }

  // 5c. Move to BE at +1R (once)
  if (rMultiple != null && rMultiple >= R.beTriggerR && !beMoved && currentStop < entryPrice) {
    return { type: 'move_stop', newStop: entryPrice, reason: 'move_to_be', tradeId: id };
  }

  return { type: 'hold' };
}

/**
 * Apply an action to the persistent state.
 */
export function applyAction(action) {
  if (action.type === 'close') {
    return closePosition(action.tradeId, action.reason, action.exitPrice);
  }

  if (action.type === 'move_stop') {
    tradesRepo.updateStop(action.tradeId, action.newStop);
    const pos = positionsRepo.get(action.tradeId);
    positionsRepo.upsert({
      tradeId:       action.tradeId,
      lastPrice:     pos?.last_price ?? null,
      lastPriceAt:   pos?.last_price_at ?? new Date().toISOString(),
      unrealizedPnl: pos?.unrealized_pnl ?? 0,
      unrealizedPct: pos?.unrealized_pct ?? 0,
      highestClose:  pos?.highest_close ?? null,
      trailActive:   action.reason === 'trail' || (pos?.trail_active === 1),
      beMoved:       action.reason === 'move_to_be' || (pos?.be_moved === 1),
      partialTaken:  pos?.partial_taken === 1,
    });
    return { applied: true, type: 'move_stop', tradeId: action.tradeId, newStop: action.newStop };
  }

  if (action.type === 'partial_exit') {
    // Mark partial as taken; we don't actually split the row in the simple model —
    // the user/broker books partial profit, we just remember it happened so we don't
    // re-trigger and we adjust quantity in place for ongoing tracking.
    const trade = tradesRepo.getById(action.tradeId);
    const remainingQty = trade.quantity - action.qty;
    // Update qty in trades table by recording partial in metadata
    const partials = JSON.parse(trade.partial_exits || '[]');
    partials.push({ qty: action.qty, price: action.exitPrice, date: new Date().toISOString(), reason: action.reason });
    partialExitStmt.run(remainingQty, JSON.stringify(partials), action.tradeId);

    const pos = positionsRepo.get(action.tradeId);
    positionsRepo.upsert({
      tradeId:       action.tradeId,
      lastPrice:     pos?.last_price ?? null,
      lastPriceAt:   pos?.last_price_at ?? new Date().toISOString(),
      unrealizedPnl: pos?.unrealized_pnl ?? 0,
      unrealizedPct: pos?.unrealized_pct ?? 0,
      highestClose:  pos?.highest_close ?? null,
      trailActive:   pos?.trail_active === 1,
      beMoved:       pos?.be_moved === 1,
      partialTaken:  true,
    });
    return { applied: true, type: 'partial_exit', tradeId: action.tradeId, qty: action.qty, price: action.exitPrice };
  }

  return { applied: false, type: action.type };
}

/**
 * Run the full exit-evaluation cycle on all open positions.
 *  - Marks them to market (already done by positionTracker.markAllToMarket if called first)
 *  - Evaluates exit rules
 *  - Applies actions
 *
 * Returns a list of actions taken.
 */
export async function runExitCycle(mode = 'paper', rules = {}) {
  const positions = listOpenPositions(mode);
  if (positions.length === 0) return { actions: [], evaluated: 0 };

  const actions = [];
  for (const pos of positions) {
    if (!pos.lastPrice) continue;
    const action = evaluateExit(pos, rules);
    if (action.type !== 'hold') {
      const result = await applyAction(action);
      actions.push({ symbol: pos.symbol, ...action, result });
    }
  }
  return { actions, evaluated: positions.length };
}


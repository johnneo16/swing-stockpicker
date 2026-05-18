/**
 * Deterministic Trade Reflection
 *
 * After every paper trade closure, generate a structured "what worked /
 * didn't / lesson" entry using simple heuristics over the trade's own data
 * — no AI yet (that's the TradingAgents integration planned for next week).
 *
 * Each reflection is stored as JSON in trades.reflection_json. The Live tab
 * surfaces them so the user accumulates a learning corpus over time.
 *
 * Signals analysed:
 *   - Exit reason (target / stop / time / panic / gap)
 *   - PnL magnitude vs the trade's initial 1R risk (R-multiple)
 *   - Holding days vs the engine's estimatedDays
 *   - Setup type's typical performance (baseline from BACKTEST stats)
 *   - Stop placement effectiveness (did it stop right at the bottom?)
 *
 * Output structure:
 *   {
 *     whatWorked:    string,   // bullet-form, 1-3 items joined with semicolons
 *     whatDidntWork: string,
 *     lesson:        string,   // single actionable takeaway
 *     setupRating:   1-10,     // how good was the setup in hindsight
 *     wouldRetake:   boolean,
 *     tags:          string[], // searchable: 'target-hit', 'fast-exit', etc.
 *   }
 */

/**
 * @param {object} trade — row from trades table (closed status)
 * @param {object} [opts]
 *   - setupBaseline: { winRate, expectancy } from backtest for this setup type
 */
export function reflectOnTrade(trade, opts = {}) {
  const exitReason = trade.exit_reason || 'unknown';
  const pnl       = trade.realized_pnl ?? 0;
  const pnlPct    = trade.realized_pct ?? 0;
  const heldDays  = trade.holding_days ?? 0;
  const estDays   = trade.est_days || 10;
  const entryPx   = trade.entry_price;
  const exitPx    = trade.exit_price;
  const initStop  = trade.initial_stop;
  const target    = trade.target_price;
  const setupType = trade.setup_type || 'Trend Analysis';
  const confidence = trade.confidence ?? 50;

  // R-multiple: how many initial-risk units did we make/lose?
  const initialRisk = entryPx - initStop;
  const rMultiple = initialRisk > 0 ? (exitPx - entryPx) / initialRisk : 0;
  const targetR = initialRisk > 0 ? (target - entryPx) / initialRisk : 0;

  const isWin = pnl > 0;
  const isHugeWin   = isWin && rMultiple >= 2.0;
  const isModestWin = isWin && rMultiple >= 0.5 && rMultiple < 2.0;
  const isSmallWin  = isWin && rMultiple < 0.5;
  const isModestLoss = !isWin && rMultiple > -1.1;
  const isFullLoss  = !isWin && rMultiple <= -1.1;

  const fastExit = heldDays <= Math.max(2, Math.floor(estDays * 0.3));
  const longHold = heldDays >= estDays * 1.3;
  const onSchedule = !fastExit && !longHold;

  const worked = [];
  const didnt  = [];
  const tags   = [];

  // ── What worked ──────────────────────────────────────────────────────────
  if (exitReason === 'target' || exitReason === 'target_hit') {
    worked.push(`Target hit cleanly at ₹${exitPx} (planned ₹${target})`);
    tags.push('target-hit');
  }
  if (exitReason === 'target_gap') {
    worked.push(`Gap-up beyond target captured a bonus`);
    tags.push('target-gap');
  }
  if (isHugeWin) {
    worked.push(`Big winner: ${rMultiple.toFixed(1)}R captured (planned ${targetR.toFixed(1)}R)`);
    tags.push('huge-win');
  }
  if (isModestWin) {
    worked.push(`Solid win: ${rMultiple.toFixed(1)}R captured`);
  }
  if (fastExit && isWin) {
    worked.push(`Fast resolution (${heldDays}d, est ${estDays}d) — capital recycled quickly`);
    tags.push('fast-win');
  }
  if (onSchedule && isWin) {
    worked.push(`Resolved on schedule (${heldDays}d ≈ est ${estDays}d) — model timing was accurate`);
  }
  if (exitReason === 'stop' && isModestLoss) {
    worked.push(`Stop did its job — loss contained at ${rMultiple.toFixed(1)}R, no spiral`);
    tags.push('stop-worked');
  }
  // Setup-baseline context
  const baseline = opts.setupBaseline;
  if (baseline && baseline.expectancy != null && isWin && pnlPct > baseline.expectancy * 1.5) {
    worked.push(`Outperformed ${setupType}'s avg expectancy (+${baseline.expectancy.toFixed(2)}%) by ${(pnlPct / baseline.expectancy).toFixed(1)}×`);
  }

  // ── What didn't work ─────────────────────────────────────────────────────
  if (exitReason === 'stop_gap') {
    didnt.push(`Stop gapped — fill was worse than stop price (slippage on ${trade.symbol})`);
    tags.push('gap-down-stop');
  }
  if (exitReason === 'panic_loss') {
    didnt.push(`Panic-exit triggered — intraday loss exceeded 7% before normal exit logic`);
    tags.push('panic');
  }
  if (exitReason === 'time' || exitReason === 'time_stop') {
    didnt.push(`Time stop hit at ${heldDays}d — trade meandered, no decisive move`);
    tags.push('time-stop');
  }
  if (isFullLoss) {
    didnt.push(`Full 1R loss — stop placement may have been too tight`);
  }
  if (isSmallWin && exitReason.includes('time')) {
    didnt.push(`Small win on time exit — could've moved stop to BE earlier to lock in more`);
  }
  if (longHold && isWin) {
    didnt.push(`Took ${heldDays}d (est ${estDays}d) — capital tied up longer than modeled`);
    tags.push('slow-win');
  }
  if (longHold && !isWin) {
    didnt.push(`Slow bleed over ${heldDays}d — time stop should've kicked sooner`);
    tags.push('slow-loss');
  }
  if (baseline && baseline.winRate != null && !isWin && baseline.winRate >= 0.55) {
    didnt.push(`${setupType} usually wins ${Math.round(baseline.winRate * 100)}% — this one bucked the trend`);
  }

  // ── Lesson (single actionable takeaway) ──────────────────────────────────
  let lesson = '';
  let setupRating = 5; // neutral baseline
  let wouldRetake = true;

  if (isHugeWin && fastExit) {
    lesson = `Repeat this exact setup type (${setupType}) when conditions align — the engine sized this well`;
    setupRating = 9;
  } else if (isHugeWin) {
    lesson = `Big win confirms the engine works on ${setupType} setups — keep selection unchanged`;
    setupRating = 8;
  } else if (isModestWin) {
    lesson = `Solid execution. Consider partial profit-taking at 1.5R to lock gains on similar trades`;
    setupRating = 7;
  } else if (isSmallWin) {
    lesson = `Small win — exit logic could be sharper. Watch if move-to-BE rule is firing too late`;
    setupRating = 5;
  } else if (isModestLoss) {
    lesson = `Loss within plan. Risk management worked — no action needed`;
    setupRating = 5;
  } else if (isFullLoss && exitReason.includes('stop')) {
    lesson = `Stop did its job preventing catastrophic loss. Re-examine: did entry pick obvious resistance?`;
    setupRating = 3;
    wouldRetake = confidence < 60 ? false : true;
  } else if (exitReason.includes('time')) {
    lesson = `No decisive move in ${heldDays}d. Consider tightening time stop for ${setupType} setups in similar regime`;
    setupRating = 4;
  } else if (exitReason === 'panic_loss') {
    lesson = `Caught a bad gap. If pattern repeats on similar names, consider regime gating ${setupType} more strictly`;
    setupRating = 2;
    wouldRetake = false;
  } else {
    lesson = `Outcome neutral. Track this entry in journal for pattern detection`;
  }

  return {
    whatWorked:    worked.length > 0 ? worked.join('; ') : '—',
    whatDidntWork: didnt.length > 0 ? didnt.join('; ') : '—',
    lesson,
    setupRating,
    wouldRetake,
    rMultiple:     Math.round(rMultiple * 100) / 100,
    targetR:       Math.round(targetR * 100) / 100,
    tags,
    generatedAt:   new Date().toISOString(),
  };
}

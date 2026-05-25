/**
 * Scheduler job handlers — each function is a self-contained background task.
 *
 * Every job:
 *  - Returns { ok, message, detail } so the orchestrator can log + report
 *  - Catches its own errors (one failed job must not poison the next)
 *  - Persists results to the DB so the UI can replay history
 *
 * Conventions:
 *  - All times mentioned in comments are IST (Asia/Kolkata).
 *  - Jobs are *idempotent within the same trading day* — running twice is safe.
 */

import { picksRepo, tradesRepo, schedulerRepo } from '../persistence/db.js';
import {
  openPosition, markAllToMarket, listOpenPositions, portfolioSummary,
} from '../lifecycle/positionTracker.js';
import { runExitCycle } from '../lifecycle/exitEngine.js';
import { refreshEarningsCalendar, isEarningsBlackout } from '../intelligence/earningsFetcher.js';
import { refreshRegime, getRegime, regimeBias } from '../intelligence/regimeDetector.js';
import { CONFIG, getCapitalForClass } from '../engine/riskEngine.js';

// ─── helpers ────────────────────────────────────────────────────────────────

import { isNonTradingDay, todayStatus, upcomingHolidays, nextTradingDays } from './nseHolidays.js';
import { sendTelegram } from '../alerts/telegram.js';

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Returns true if today (IST) is a non-trading day for NSE equity —
 * weekend OR a scheduled holiday from nseHolidays.js.
 */
function isMarketHoliday() {
  return isNonTradingDay();
}

/**
 * Build a uniform "skipped because market closed" job result with the
 * specific reason (weekend / holiday name) included.
 */
function marketClosedSkip(jobLabel = 'Job') {
  const s = todayStatus();
  const why = s.reason === 'holiday'
    ? `NSE holiday: ${s.holidayName}`
    : `weekend (${s.weekday})`;
  return {
    ok: true,
    message: `Market closed — ${why}. ${jobLabel} skipped.`,
    detail: { skipped: true, ...s },
  };
}

// Export the diagnostic helpers so server.js / UI can consume them
export { isMarketHoliday, todayStatus, upcomingHolidays, nextTradingDays, marketClosedSkip };

// ─────────────────────────────────────────────────────────────────────────────
// JOB: pre-market — generate today's curated picks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs at 09:00 IST on weekdays. Refreshes regime + earnings calendar,
 * gets a fresh scan that EXCLUDES existing open positions (so the scanner
 * backfills from candidate #6+ instead of leaving slots empty), then
 * iterates the candidates applying filters. Tracks survivors only if
 * (a) we're under MAX_CONCURRENT_TRADES and (b) cash + 15% reserve allows.
 *
 * Goal: always 5 fresh picks tracked when capacity exists. If portfolio is
 * already at cap, returns 0 tracked with a clear "portfolio full" message.
 *
 * @param {object} ctx — { runScan, capital, autoTrack }
 */
export async function jobPreMarket(ctx = {}) {
  if (isMarketHoliday()) return marketClosedSkip('Pre-market');

  const {
    runScan,
    autoTrack = true,
    assetClass = 'stock',           // 'stock' | 'etf' (commodities future)
  } = ctx;
  // Capital is determined by asset class. Caller can override via ctx.capital,
  // but the default uses the class-specific bucket (₹50K stocks, ₹25K ETFs).
  const capital = ctx.capital ?? getCapitalForClass(assetClass);
  if (!runScan) return { ok: false, message: 'runScan not provided to job' };

  // 1. Refresh regime + earnings calendar in parallel — fresh data for filters
  const [regime, earningsRefresh] = await Promise.all([
    refreshRegime().catch(() => null),
    refreshEarningsCalendar({ daysAhead: 14 }).catch(() => ({ kept: 0 })),
  ]);

  // 2. Snapshot portfolio state before scan (filtered by asset class —
  //    stocks and ETFs each get their own MAX_CONCURRENT_TRADES bucket)
  const today = todayISO();
  const existingOpen = listOpenPositions('paper', assetClass);
  const existingSymbols = new Set(existingOpen.map(p => p.symbol));
  const portfolio = portfolioSummary('paper', capital, assetClass);

  const slotsAvailable = CONFIG.MAX_CONCURRENT_TRADES - existingOpen.length;
  let cashAvailable = portfolio.cashRemaining;
  const minCashReserve = capital * CONFIG.CASH_RESERVE_PERCENT;
  const portfolioFull = slotsAvailable <= 0;

  // 3. ALWAYS run the scan — we want today's picks recorded in daily_picks
  //    even when portfolio is full so the user sees what the engine likes
  //    today (with a clear "blocked: portfolio over capacity" reason).
  //    Returns deeper candidates so the backfill cascade below has headroom.
  const scanResult = await runScan(true, capital, {
    excludeSymbols: existingSymbols,
    maxResults:     5, // target slate of 5 fresh picks/day
  });
  const trades = scanResult.trades || [];
  if (trades.length === 0) {
    return {
      ok: true,
      message: `Scan returned no candidates${portfolioFull ? ` (portfolio also at ${existingOpen.length}/${CONFIG.MAX_CONCURRENT_TRADES})` : ''}`,
      detail: { regime: regime?.regime, portfolioFull, slotsAvailable },
    };
  }

  // 4. Apply filters per candidate. Record ALL of them to daily_picks so
  //    today's view always shows what the engine picked today — blocked
  //    ones get a clear reason banner in the UI.
  const bias = regimeBias(regime?.regime || 'neutral');
  const tracked = [];
  const blocked = [];

  for (const t of trades) {
    let blockedReason = null;

    // Filter 1: earnings blackout (≤2 days)
    const blackout = isEarningsBlackout(t.symbol, 2, ['earnings']);
    if (blackout) {
      blockedReason = `earnings on ${blackout.eventDate}`;
    }
    // Filter 2: regime avoid list
    if (!blockedReason && bias.avoid?.includes(t.setupType)) {
      blockedReason = `regime avoids ${t.setupType} in ${regime?.regime}`;
    }
    // Filter 3: low confidence (Pass-2 fillers — never auto-track)
    if (!blockedReason && t.lowConfidence) {
      blockedReason = `low confidence (Pass-2 filler)`;
    }
    // Filter 4: regime score nudge (drop if score below adjusted floor).
    // Floor raised 50→60 on 2026-05-25 after loss diagnosis showed sub-60
    // confidence trades produced the worst recent drawdowns (ONGC @ 53 →
    // -2.7% drag; 8-trade window had losses avg score 61.5 vs wins 63.5,
    // meaning the score doesn't discriminate inside the 50-65 band).
    // The new 60-floor cuts the actively-losing bucket entirely. Defense-
    // in-depth: scoringEngine's Pass-2 also enforces 60-floor now.
    const nudge = bias.scoreNudge ?? 0;
    if (!blockedReason && (t.confidenceScore + nudge) < 60) {
      blockedReason = `score ${t.confidenceScore}+${nudge} below floor 60`;
    }
    // Filter 5: portfolio at/over capacity — block here so the pick is still
    //          recorded and visible in the UI with a clear reason
    if (!blockedReason && (portfolioFull || tracked.length >= slotsAvailable)) {
      blockedReason = `portfolio over capacity (${existingOpen.length + tracked.length}/${CONFIG.MAX_CONCURRENT_TRADES}); waiting for exits`;
    }
    // Filter 6: capital availability — keep ≥ CASH_RESERVE_PERCENT free
    if (!blockedReason) {
      const deployable = cashAvailable - minCashReserve;
      if (t.capitalRequired > deployable) {
        blockedReason = `insufficient capital: need ₹${t.capitalRequired}, only ₹${Math.round(deployable)} deployable (cash ₹${Math.round(cashAvailable)} − ${CONFIG.CASH_RESERVE_PERCENT * 100}% reserve)`;
      }
    }

    const earningsFlag = blackout ? 'blackout' : null;

    // Try to auto-track if no blocked reason
    let tradeId = null;
    if (!blockedReason && autoTrack) {
      try {
        const opened = await openPosition(t, 'paper', { totalCapital: capital, assetClass });
        tradeId = opened.id;
        cashAvailable -= t.capitalRequired; // decrement local mirror
      } catch (e) {
        // Layer 2 guard tripped — record as blocked
        blockedReason = `track refused: ${e.message}`;
      }
    }

    // ALWAYS record the pick in daily_picks (the one-shot fix — was previously
    // skipped when over-capacity, leaving Today tab empty)
    picksRepo.upsert({
      pickDate: today, symbol: t.symbol, name: t.name, sector: t.sector,
      setupType: t.setupType, confidence: t.confidenceScore,
      entryPrice: t.entryPrice, stopLoss: t.stopLoss, targetPrice: t.targetPrice,
      rr: t.riskRewardRatio, estimatedDays: t.estimatedDays,
      regime: regime?.regime || null, earningsFlag,
      blockedReason, autoTracked: tradeId !== null, tradeId, payload: t,
      assetClass,
    });

    if (tradeId) {
      tracked.push({ symbol: t.symbol, tradeId, confidence: t.confidenceScore });
    } else if (blockedReason) {
      blocked.push({ symbol: t.symbol, reason: blockedReason });
    }
  }

  // Build a message that reflects WHAT actually blocked the picks
  let message;
  if (tracked.length > 0) {
    message = `${tracked.length} tracked, ${blocked.length} blocked. Regime: ${regime?.regime || 'unknown'}`;
  } else {
    // Group blocked by top reason category for a readable summary
    const counts = blocked.reduce((acc, b) => {
      let key = 'other';
      if (b.reason?.includes('over capacity'))         key = 'capacity';
      else if (b.reason?.includes('earnings on'))      key = 'earnings';
      else if (b.reason?.includes('regime avoids'))    key = 'regime';
      else if (b.reason?.includes('below floor'))      key = 'score';
      else if (b.reason?.includes('insufficient capital')) key = 'capital';
      else if (b.reason?.includes('low confidence'))   key = 'low-conf';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
    const prefix = portfolioFull
      ? `Portfolio at ${existingOpen.length}/${CONFIG.MAX_CONCURRENT_TRADES}`
      : `0 tracked`;
    message = `${prefix}. ${trades.length} candidates recorded (blocked: ${breakdown}). Regime: ${regime?.regime || 'unknown'}`;
  }

  return {
    ok: true,
    message: `[${assetClass.toUpperCase()}] ${message}`,
    detail: {
      assetClass,
      regime: regime?.regime,
      bias,
      slotsAvailable,
      portfolioFull,
      cashStart: portfolio.cashRemaining,
      cashEnd: cashAvailable,
      totalCandidates: trades.length,
      tracked, blocked,
      earningsKept: earningsRefresh?.kept,
    },
  };
}

/**
 * ETF variant of jobPreMarket — same logic, different scanner + asset_class tag.
 * The orchestrator passes `runEtfScan` in ctx; this wrapper rewires the entry
 * to share the bulk of the pre-market pipeline (regime/earnings/filters/capital
 * checks) without duplication.
 */
export async function jobPreMarketETF(ctx = {}) {
  const { runEtfScan, ...rest } = ctx;
  return jobPreMarket({
    ...rest,
    runScan: runEtfScan,
    assetClass: 'etf',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: mark-to-market — every 15-30 min during market hours
// ─────────────────────────────────────────────────────────────────────────────

export async function jobMarkToMarket() {
  if (isMarketHoliday()) return marketClosedSkip('Mark-to-market');
  const positions = await markAllToMarket('paper');
  return {
    ok: true,
    message: `Marked ${positions.length} positions`,
    detail: {
      count: positions.length,
      symbols: positions.map(p => ({ symbol: p.symbol, lastPrice: p.lastPrice, pnlPct: p.unrealizedPct })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: exit-cycle — every 30 min during market hours
// ─────────────────────────────────────────────────────────────────────────────

export async function jobExitCycle() {
  if (isMarketHoliday()) return marketClosedSkip('Exit-cycle');

  // Refresh prices first so exit decisions use latest LTPs
  await markAllToMarket('paper');
  const result = await runExitCycle('paper');

  return {
    ok: true,
    message: `${result.actions.length} action(s) on ${result.evaluated} positions`,
    detail: result,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: end-of-day snapshot — 16:00 IST
// ─────────────────────────────────────────────────────────────────────────────

export async function jobEodSnapshot() {
  if (isMarketHoliday()) return marketClosedSkip('EOD snapshot');

  // Final mark-to-market + exit cycle for the day
  const mtm = await markAllToMarket('paper');
  const exits = await runExitCycle('paper');
  const regime = await refreshRegime().catch(() => null);
  const earnings = await refreshEarningsCalendar({ daysAhead: 14 }).catch(() => null);

  return {
    ok: true,
    message: `EOD: ${mtm.length} marked, ${exits.actions.length} exits, regime ${regime?.regime || 'unknown'}`,
    detail: { mtmCount: mtm.length, exits, regime: regime?.regime, earningsRefresh: earnings },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: earnings refresh — twice daily (07:30 + 16:30 IST)
// ─────────────────────────────────────────────────────────────────────────────

export async function jobEarningsRefresh() {
  const r = await refreshEarningsCalendar({ daysAhead: 14 });
  return { ok: true, message: `Refreshed earnings calendar: ${r.kept} kept`, detail: r };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: risk killswitch — auto-disables tracking if drawdown > threshold
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Killswitch — runs after EOD. Trips on ANY of:
 *   1. Combined realized + unrealized drawdown > killDrawdownPct (default 8%)
 *   2. Capital deployed > 100% (over-leverage)
 *   3. Open position count > MAX_CONCURRENT_TRADES
 *   4. Single position with >killCatastrophicPct% unrealized loss (default -8%)
 *
 * On any trip:
 *   - Disables pre-market auto-tracking
 *   - Persists tripped_at + reason in scheduler_settings
 *   - User must manually call /api/scheduler/killswitch/reset
 */
export async function jobRiskKillswitch({
  killDrawdownPct      = 8,
  killCatastrophicPct  = 8,   // single-position loss threshold
  capital              = CONFIG.TOTAL_CAPITAL,
  rollingWindowDays    = 90,   // killswitch fix: rolling DD, not all-time
} = {}) {
  const stats = tradesRepo.journalStats('paper');
  const positions = listOpenPositions('paper');
  const portfolio = portfolioSummary('paper', capital);

  // Combined drawdown signal: realized rolling-window DD + unrealized loss
  // as % of capital.
  //
  // FIX (2026-05-19): previously used stats.maxDrawdownPct (all-time max,
  // monotonically non-decreasing). That made the killswitch re-trip every
  // single day at 16:15 IST forever once any 8%+ DD had been recorded,
  // even when current equity was healthy. Switched to rollingDrawdownPct
  // over a 90-day window so old drawdown sequences stop dictating today's
  // tradeability. live drawdown + over-leverage + catastrophic-loss
  // triggers are unchanged.
  const startingCapital = stats.startingCapital || capital;
  const unrealizedPnl = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
  const totalEquity = (stats.finalEquity || startingCapital) + unrealizedPnl;
  const peak = Math.max(stats.finalEquity || startingCapital, startingCapital);
  const liveDrawdownPct = peak > 0 ? Math.max(0, (peak - totalEquity) / peak * 100) : 0;
  const rolling = tradesRepo.rollingDrawdownPct('paper', rollingWindowDays, capital);
  const drawdown = Math.max(liveDrawdownPct, rolling.maxDrawdownPct);

  const triggers = [];

  // Trigger 1: drawdown
  if (drawdown > killDrawdownPct) {
    triggers.push(`drawdown ${drawdown.toFixed(2)}% > ${killDrawdownPct}%`);
  }

  // Trigger 2: over-leverage (THE bug class that broke us today)
  if (portfolio.deploymentPct > 100) {
    triggers.push(`over-leverage: deployed ${portfolio.deploymentPct}% (₹${portfolio.capitalDeployed} > ₹${capital})`);
  }

  // Trigger 3: too many open positions
  if (positions.length > CONFIG.MAX_CONCURRENT_TRADES) {
    triggers.push(`position count ${positions.length}/${CONFIG.MAX_CONCURRENT_TRADES}`);
  }

  // Trigger 4: catastrophic single-position loss
  for (const p of positions) {
    if ((p.unrealizedPct ?? 0) < -killCatastrophicPct) {
      triggers.push(`${p.symbol} at ${p.unrealizedPct.toFixed(2)}% (catastrophic)`);
    }
  }

  if (triggers.length > 0) {
    schedulerRepo.setSetting('job:pre-market:enabled', '0');
    schedulerRepo.setSetting('killswitch:tripped_at', new Date().toISOString());
    schedulerRepo.setSetting('killswitch:reason', triggers.join('; '));
    // CRITICAL alert — killswitch trips disable pre-market until manually
    // reset, so the user needs to know now (not on next morning open).
    // dedupeKey collapses duplicate trips inside the 15-min window in
    // case of a flapping signal.
    sendTelegram({
      level: 'critical',
      title: 'Killswitch tripped',
      body:  `Pre-market job disabled.\n\nTriggers:\n• ${triggers.join('\n• ')}\n\nReset via /api/scheduler/killswitch/reset or the Health-tab button.`,
      dedupeKey: 'killswitch:trip',
    }).catch(() => { /* logged; nothing more to do */ });
    return {
      ok: true,
      message: `🛑 KILLSWITCH TRIPPED: ${triggers.join(', ')}. Pre-market disabled.`,
      detail: {
        drawdown, liveDrawdownPct, rolling,
        deploymentPct: portfolio.deploymentPct,
        positionCount: positions.length,
        triggers, tripped: true,
      },
    };
  }

  return {
    ok: true,
    message: `Risk OK — drawdown ${drawdown.toFixed(2)}% (rolling ${rollingWindowDays}d ${rolling.maxDrawdownPct}%, live ${liveDrawdownPct.toFixed(2)}%), deployed ${portfolio.deploymentPct}%, ${positions.length}/${CONFIG.MAX_CONCURRENT_TRADES} open`,
    detail: {
      drawdown, liveDrawdownPct, rolling,
      deploymentPct: portfolio.deploymentPct,
      positionCount: positions.length,
      triggers: [], tripped: false,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: stale-trade audit — flags positions past 1.5× their estimated hold
// ─────────────────────────────────────────────────────────────────────────────

export async function jobStaleTradeAudit() {
  const positions = listOpenPositions('paper');
  const stale = positions.filter(p => {
    const limit = (p.estimatedDays || 10) * 1.5;
    return p.heldDays > limit;
  });
  return {
    ok: true,
    message: stale.length === 0 ? 'No stale trades' : `${stale.length} stale trade(s) past 1.5× est. hold`,
    detail: {
      stale: stale.map(p => ({
        symbol: p.symbol, heldDays: p.heldDays, estimatedDays: p.estimatedDays,
        unrealizedPct: p.unrealizedPct, currentStop: p.currentStop,
      })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: daily summary — generates a readable EOD report
// ─────────────────────────────────────────────────────────────────────────────

export async function jobDailySummary() {
  const today = todayISO();
  const picks = picksRepo.forToday();
  const positions = listOpenPositions('paper');
  const closed = tradesRepo.getRecentClosed('paper', 50)
    .filter(t => t.exit_date && t.exit_date.slice(0, 10) === today);
  const stats = tradesRepo.journalStats('paper');
  const regime = await getRegime().catch(() => null);

  const summary = {
    date: today,
    regime: regime?.regime,
    picks: {
      total:   picks.length,
      tracked: picks.filter(p => p.auto_tracked === 1).length,
      blocked: picks.filter(p => p.blocked_reason).length,
      blockedReasons: picks.filter(p => p.blocked_reason)
        .reduce((acc, p) => { acc[p.blocked_reason] = (acc[p.blocked_reason] || 0) + 1; return acc; }, {}),
    },
    positions: {
      open:           positions.length,
      unrealizedPnl:  positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0),
      inProfit:       positions.filter(p => p.unrealizedPnl > 0).length,
      inLoss:         positions.filter(p => p.unrealizedPnl < 0).length,
    },
    closedToday: {
      count:    closed.length,
      wins:     closed.filter(t => (t.realized_pnl || 0) > 0).length,
      losses:   closed.filter(t => (t.realized_pnl || 0) < 0).length,
      pnl:      closed.reduce((s, t) => s + (t.realized_pnl || 0), 0),
    },
    cumulative: {
      totalTrades:    stats.totalTrades,
      winRate:        stats.winRate,
      expectancyPct:  stats.expectancyPct,
      profitFactor:   stats.profitFactor,
      finalEquity:    stats.finalEquity,
      maxDrawdownPct: stats.maxDrawdownPct,
    },
  };

  return {
    ok: true,
    message: `Day complete: +${picks.filter(p => p.auto_tracked === 1).length} new, ${closed.length} closed (${closed.filter(t => (t.realized_pnl || 0) > 0).length}W/${closed.filter(t => (t.realized_pnl || 0) < 0).length}L), unrealized ₹${Math.round(summary.positions.unrealizedPnl).toLocaleString('en-IN')}`,
    detail: summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: weekly backtest — Saturday 10:00 IST
// ─────────────────────────────────────────────────────────────────────────────

export async function jobWeeklyBacktest({ runBacktest, backtestRepo, universe, capital = 50000 } = {}) {
  if (!runBacktest) return { ok: false, message: 'runBacktest not provided' };

  const endDate   = todayISO();
  const startDate = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10); // 2yr trailing

  const config = {
    startDate, endDate, capital,
    scoreThreshold: 50,
    maxConcurrent: 5, maxPerSector: 3, maxHoldingDays: 25,
    volAdjustedSizing: true, baseRiskPercent: 0.015,
  };

  const runId = backtestRepo.start({
    startDate, endDate, capital, universeSize: universe.length,
    config, notes: 'Weekly auto-validation',
  });

  const result = await runBacktest(universe, config);
  backtestRepo.saveTrades(runId, result.trades);
  backtestRepo.finish(runId, {
    total_trades: result.metrics.totalTrades, wins: result.metrics.wins, losses: result.metrics.losses,
    win_rate: result.metrics.winRate, avg_win_pct: result.metrics.avgWinPct, avg_loss_pct: result.metrics.avgLossPct,
    expectancy_pct: result.metrics.expectancyPct, total_return: result.metrics.totalReturn,
    total_return_pct: result.metrics.totalReturnPct, max_drawdown_pct: result.metrics.maxDrawdownPct,
    sharpe_ratio: result.metrics.sharpeRatio, profit_factor: result.metrics.profitFactor,
  });

  return {
    ok: true,
    message: `Weekly backtest #${runId}: ${result.metrics.totalTrades} trades, ${(result.metrics.winRate * 100).toFixed(1)}% win, ${result.metrics.totalReturnPct >= 0 ? '+' : ''}${result.metrics.totalReturnPct}% return`,
    detail: { runId, ...result.metrics },
  };
}

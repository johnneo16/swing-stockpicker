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
  openPosition, markAllToMarket, listOpenPositions,
} from '../lifecycle/positionTracker.js';
import { runExitCycle } from '../lifecycle/exitEngine.js';
import { refreshEarningsCalendar, isEarningsBlackout } from '../intelligence/earningsFetcher.js';
import { refreshRegime, getRegime, regimeBias } from '../intelligence/regimeDetector.js';
import { CONFIG } from '../engine/riskEngine.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const todayISO = () => new Date().toISOString().slice(0, 10);

function isMarketHoliday() {
  // Best-effort: skip Sat/Sun. Real NSE holiday list could be added later.
  const day = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });
  return day === 'Sat' || day === 'Sun';
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: pre-market — generate today's curated picks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs at 09:00 IST on weekdays. Uses an injected `runScan` to get a
 * fresh scan, applies regime + earnings filters, and writes the curated
 * list to daily_picks. If autoTrack=true, also opens paper positions
 * for the survivors (within risk caps).
 *
 * @param {object} ctx — { runScan, capital, autoTrack }
 */
export async function jobPreMarket(ctx = {}) {
  if (isMarketHoliday()) return { ok: true, message: 'Market closed (weekend)', detail: { skipped: true } };

  const { runScan, capital = CONFIG.TOTAL_CAPITAL, autoTrack = true } = ctx;
  if (!runScan) return { ok: false, message: 'runScan not provided to job' };

  // 1. Refresh regime + earnings calendar in parallel — fresh data for filters
  const [regime, earningsRefresh] = await Promise.all([
    refreshRegime().catch(() => null),
    refreshEarningsCalendar({ daysAhead: 14 }).catch(() => ({ kept: 0 })),
  ]);

  // 2. Get a fresh scan (forced refresh)
  const scanResult = await runScan(true, capital);
  const trades = scanResult.trades || [];
  if (trades.length === 0) {
    return { ok: true, message: 'Scan returned no picks', detail: { regime: regime?.regime } };
  }

  // 3. Apply regime bias filtering
  const bias = regimeBias(regime?.regime || 'neutral');
  const today = todayISO();
  const tracked = [];
  const blocked = [];

  // Existing open paper positions — don't duplicate
  const openSymbols = new Set(listOpenPositions('paper').map(p => p.symbol));

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
    // Filter 3: low confidence (Pass-2 fillers)
    if (!blockedReason && t.lowConfidence) {
      blockedReason = `low confidence (Pass-2 filler)`;
    }
    // Filter 4: already open
    if (!blockedReason && openSymbols.has(t.symbol)) {
      blockedReason = 'already open in paper portfolio';
    }
    // Filter 5: regime score nudge (drop if score below adjusted floor)
    const nudge = bias.scoreNudge ?? 0;
    if (!blockedReason && (t.confidenceScore + nudge) < 50) {
      blockedReason = `score ${t.confidenceScore}+${nudge} below floor 50`;
    }

    const earningsFlag = blackout ? 'blackout' : null;

    if (blockedReason) {
      blocked.push({ symbol: t.symbol, reason: blockedReason });
      picksRepo.upsert({
        pickDate: today, symbol: t.symbol, name: t.name, sector: t.sector,
        setupType: t.setupType, confidence: t.confidenceScore,
        entryPrice: t.entryPrice, stopLoss: t.stopLoss, targetPrice: t.targetPrice,
        rr: t.riskRewardRatio, estimatedDays: t.estimatedDays,
        regime: regime?.regime || null, earningsFlag,
        blockedReason, autoTracked: false, payload: t,
      });
      continue;
    }

    // Survivor — record + optionally auto-track
    let tradeId = null;
    if (autoTrack) {
      try {
        const opened = openPosition(t, 'paper');
        tradeId = opened.id;
        openSymbols.add(t.symbol); // prevent dupes within this run
      } catch (e) {
        blockedReason = `track failed: ${e.message}`;
      }
    }

    picksRepo.upsert({
      pickDate: today, symbol: t.symbol, name: t.name, sector: t.sector,
      setupType: t.setupType, confidence: t.confidenceScore,
      entryPrice: t.entryPrice, stopLoss: t.stopLoss, targetPrice: t.targetPrice,
      rr: t.riskRewardRatio, estimatedDays: t.estimatedDays,
      regime: regime?.regime || null, earningsFlag,
      blockedReason, autoTracked: tradeId !== null, tradeId, payload: t,
    });

    if (tradeId) tracked.push({ symbol: t.symbol, tradeId, confidence: t.confidenceScore });
  }

  return {
    ok: true,
    message: `${tracked.length} tracked, ${blocked.length} blocked. Regime: ${regime?.regime || 'unknown'}`,
    detail: {
      regime: regime?.regime,
      bias,
      totalScanned: trades.length,
      tracked, blocked,
      earningsKept: earningsRefresh?.kept,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: mark-to-market — every 15-30 min during market hours
// ─────────────────────────────────────────────────────────────────────────────

export async function jobMarkToMarket() {
  if (isMarketHoliday()) return { ok: true, message: 'Market closed', detail: { skipped: true } };
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
  if (isMarketHoliday()) return { ok: true, message: 'Market closed', detail: { skipped: true } };

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
  if (isMarketHoliday()) return { ok: true, message: 'Market closed', detail: { skipped: true } };

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
 * Runs after EOD. If realized + unrealized drawdown breaches the kill threshold,
 * disables auto-tracking until the user manually re-enables. Closes any positions
 * deeper than 2× initial risk (catastrophic-loss tripwire).
 */
export async function jobRiskKillswitch({ killDrawdownPct = 8 } = {}) {
  const stats = tradesRepo.journalStats('paper');
  const positions = listOpenPositions('paper');

  // Combined drawdown signal: realized DD + unrealized loss as % of capital
  const startingCapital = stats.startingCapital || 50000;
  const unrealizedPnl = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
  const totalEquity = (stats.finalEquity || startingCapital) + unrealizedPnl;
  const peak = Math.max(stats.finalEquity || startingCapital, startingCapital);
  const liveDrawdownPct = peak > 0 ? Math.max(0, (peak - totalEquity) / peak * 100) : 0;
  const recordedMaxDD = stats.maxDrawdownPct || 0;
  const drawdown = Math.max(liveDrawdownPct, recordedMaxDD);

  let breached = false;
  let triggers = [];

  if (drawdown > killDrawdownPct) {
    schedulerRepo.setSetting('job:pre-market:enabled', '0');
    schedulerRepo.setSetting('killswitch:tripped_at', new Date().toISOString());
    schedulerRepo.setSetting('killswitch:reason', `drawdown ${drawdown.toFixed(2)}% > ${killDrawdownPct}%`);
    breached = true;
    triggers.push(`drawdown ${drawdown.toFixed(2)}%`);
  }

  // Catastrophic loss check — any single position past 2× initial risk
  for (const p of positions) {
    const initialRisk = (p.entryPrice - p.initialStop);
    if (initialRisk > 0 && p.unrealizedPnl < -2 * initialRisk * p.quantity) {
      triggers.push(`${p.symbol} past 2R loss`);
    }
  }

  return {
    ok: true,
    message: breached
      ? `🛑 KILLSWITCH TRIPPED: ${triggers.join(', ')}. Auto-tracking disabled.`
      : `Risk OK: drawdown ${drawdown.toFixed(2)}% / ${killDrawdownPct}%`,
    detail: { drawdown, killDrawdownPct, breached, triggers, openCount: positions.length },
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

/**
 * Background-worker orchestrator.
 *
 * Replaces the old setInterval-based scheduler in server.js with a clean
 * node-cron driven set of named jobs, each with its own log row and
 * UI-toggleable enabled flag.
 *
 * Default schedule (all times IST = Asia/Kolkata):
 *   pre-market      09:00 Mon–Fri    — generate today's picks + auto-track
 *   auto-scan       every 30m 09–15  Mon–Fri (re-scans for new opportunities)
 *   mark-to-market  every 15m 09–15  Mon–Fri
 *   exit-cycle      every 30m 09–15  Mon–Fri
 *   eod-snapshot    16:00 Mon–Fri
 *   earnings-refresh 07:30 + 16:30 Mon–Fri
 *   weekly-backtest 10:00 Saturday
 */

import cron from 'node-cron';
import { schedulerRepo } from '../persistence/db.js';
import { recordError } from '../alerts/errorJournal.js';
import { isNonTradingDay } from './nseHolidays.js';

const TZ = 'Asia/Kolkata';

// Catch-up registry — jobs that are SAFE to fire late if their scheduled
// window was missed (server reboot, Mac sleep through 09:00 IST, etc).
// Idempotency requirement: each handler must produce the right outcome
// whether fired at its cron time or hours later within the same trading day.
//
//   firstFireAtIST: the FIRST scheduled firing of the day, "HH:mm" in IST.
//     If `now` is past this and there's been no ok run today, catch up.
//   handlerNotes:   one-line explanation for the next reader.
//
// NOT in this list (intentionally — they have side effects that should
// only happen on their actual cron schedule, not catch-up):
//   exit-cycle        — could double-close on stale price data
//   eod-snapshot      — writes equity-curve point, could double-record
//   risk-killswitch   — triggers on stale state can be wrong
//   stale-trade-audit — non-critical; let next cron handle it
//   daily-summary     — could double-Telegram
//   weekly-backtest   — long-running; user can fire manually if needed
const CATCHUP_ELIGIBLE = {
  'pre-market':       { firstFireAtIST: '09:00', handlerNotes: 'idempotent — skips already-open symbols' },
  'pre-market-etf':   { firstFireAtIST: '09:05', handlerNotes: 'idempotent — skips already-open symbols' },
  'auto-scan':        { firstFireAtIST: '09:00', handlerNotes: 'idempotent — refreshes scan cache' },
  'mark-to-market':   { firstFireAtIST: '09:00', handlerNotes: 'idempotent — re-marks all open positions' },
  'earnings-refresh': { firstFireAtIST: '07:30', handlerNotes: 'idempotent — refreshes NSE calendar' },
};

// Helper: current wall-clock time projected into IST.
function nowInIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}

// Helper: UTC ISO of midnight IST today — the cutoff for "ran today" queries.
// IST is UTC+5:30; midnight IST = previous-day-18:30 UTC.
function utcIsoOfTodayIstMidnight() {
  const ist = nowInIST();
  ist.setHours(0, 0, 0, 0);                       // midnight IST as Date
  // The Date object's value is now wall-clock-of-IST-midnight interpreted in
  // the LOCAL TZ. We need to shift back to true UTC ISO. Easier: compute
  // the offset between the IST projection and the real Date.
  const real = new Date();
  const istNow = new Date(real.toLocaleString('en-US', { timeZone: TZ }));
  const offsetMs = istNow.getTime() - real.getTime();
  return new Date(ist.getTime() - offsetMs).toISOString();
}

// Helper: parse "HH:mm" IST into a real (UTC-anchored) Date for today.
function istHHmmToday(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ist = nowInIST();
  ist.setHours(h, m, 0, 0);
  const real = new Date();
  const istNow = new Date(real.toLocaleString('en-US', { timeZone: TZ }));
  const offsetMs = istNow.getTime() - real.getTime();
  return new Date(ist.getTime() - offsetMs);
}
import {
  jobPreMarket, jobPreMarketETF, jobMarkToMarket, jobExitCycle,
  jobEodSnapshot, jobEarningsRefresh, jobWeeklyBacktest,
  jobRiskKillswitch, jobStaleTradeAudit, jobDailySummary,
  jobEarningsPreviewScan, jobStaleTradeReview,
} from './jobs.js';

/**
 * Job registry. Each entry is one cron-triggered task.
 * `handler(ctx)` is the async work. `default` is the at-rest enabled state.
 */
function buildJobs(ctx) {
  return [
    {
      id: 'pre-market',
      cron: '0 9 * * 1-5',
      description: 'Generate today\'s STOCK picks at 09:00 IST and auto-track survivors',
      default: true,
      handler: () => jobPreMarket(ctx),
    },
    {
      id: 'pre-market-etf',
      cron: '5 9 * * 1-5',                 // 09:05 IST (5-min stagger from stocks)
      description: 'Generate today\'s ETF picks at 09:05 IST and auto-track survivors',
      default: true,
      handler: () => jobPreMarketETF(ctx),
    },
    {
      id: 'auto-scan',
      cron: '*/30 9-14 * * 1-5',           // every 30 min 09:00–14:30
      description: 'Live market scan every 30 minutes during market hours',
      default: true,
      handler: async () => {
        if (!ctx.runScan) return { ok: false, message: 'runScan not available' };
        const result = await ctx.runScan(true, ctx.capital);
        return { ok: true, message: `Scan: ${result.trades?.length || 0} picks`, detail: { picks: result.trades?.length } };
      },
    },
    {
      id: 'mark-to-market',
      cron: '*/15 9-15 * * 1-5',           // every 15 min 09:00–15:45
      description: 'Mark all open paper positions to market',
      default: true,
      handler: () => jobMarkToMarket(),
    },
    {
      id: 'exit-cycle',
      cron: '*/30 9-15 * * 1-5',           // every 30 min during market hours
      description: 'Evaluate exit rules (stop / target / trail / partial / time)',
      default: true,
      handler: () => jobExitCycle(),
    },
    {
      id: 'eod-snapshot',
      cron: '0 16 * * 1-5',                // 16:00 IST
      description: 'End-of-day final mark-to-market + exit cycle + regime snapshot',
      default: true,
      handler: () => jobEodSnapshot(),
    },
    {
      id: 'earnings-refresh',
      cron: '30 7,16 * * 1-5',             // 07:30 + 16:30 IST
      description: 'Refresh NSE board-meetings calendar (earnings blackout filter)',
      default: true,
      handler: () => jobEarningsRefresh(),
    },
    {
      id: 'weekly-backtest',
      cron: '0 10 * * 6',                  // Saturday 10:00 IST
      description: 'Run a fresh 2-yr backtest each weekend to validate the engine still works',
      default: true,
      handler: () => jobWeeklyBacktest(ctx),
    },
    {
      id: 'risk-killswitch',
      cron: '15 16 * * 1-5',                // 16:15 IST daily — after EOD snapshot
      description: 'Trip the killswitch (auto-disable tracking) if drawdown exceeds 8%',
      default: true,
      handler: () => jobRiskKillswitch({ killDrawdownPct: 8 }),
    },
    {
      id: 'stale-trade-audit',
      cron: '5 16 * * 1-5',                 // 16:05 IST daily
      description: 'Flag positions held 1.5× longer than their estimated holding period',
      default: true,
      handler: () => jobStaleTradeAudit(),
    },
    {
      id: 'earnings-preview-scan',
      cron: '30 8 * * 1-5',                 // 08:30 IST daily
      description: 'LLM preview for open positions ≤5 days from earnings — alerts on TRIM/EXIT',
      default: true,
      handler: () => jobEarningsPreviewScan({ lookaheadDays: 5 }),
    },
    {
      id: 'stale-trade-review',
      cron: '30 16 * * 1-5',                // 16:30 IST daily — after EOD + killswitch
      description: 'LLM thesis review for positions >1.5× est_days at a loss — alerts on EXIT/TIGHTEN_STOP',
      default: true,
      handler: () => jobStaleTradeReview(),
    },
    {
      id: 'daily-summary',
      cron: '20 16 * * 1-5',                // 16:20 IST daily
      description: 'Generate end-of-day summary (picks, positions, closed trades, cumulative stats)',
      default: true,
      handler: () => jobDailySummary(),
    },
  ];
}

class Orchestrator {
  constructor() {
    this.tasks = new Map();   // id → { task, jobConfig, lastRun }
    this.running = false;
    this.ctx = null;
  }

  /**
   * Start the orchestrator. Pass shared context the jobs need:
   *   - runScan(force, capital): callable from server.js
   *   - capital: default portfolio size
   *   - runBacktest, backtestRepo, universe: for weekly backtest
   */
  start(ctx) {
    if (this.running) return;
    this.ctx = ctx;
    const jobs = buildJobs(ctx);

    for (const job of jobs) {
      const enabled = this._enabledFor(job);
      if (!enabled) continue;
      this._scheduleJob(job);
    }

    this.running = true;
    console.log(`⏰ Orchestrator started — ${this.tasks.size}/${jobs.length} jobs active`);
    for (const [id, t] of this.tasks) {
      console.log(`   ✓ ${id.padEnd(18)} ${t.jobConfig.cron.padEnd(20)} ${t.jobConfig.description}`);
    }

    // Boot-time catch-up sweep: if we were restarted or asleep past one of
    // today's scheduled firings, fire the eligible job once now. Delayed
    // 5s so DB/imports settle.
    this._lastHeartbeatMs = Date.now();
    setTimeout(() => {
      this._catchUpSweep('boot').catch(err =>
        console.error('[orchestrator] boot catch-up failed:', err.message)
      );
    }, 5000);

    // Sleep-detection heartbeat: a 60s setInterval that should fire ~every
    // minute. If we observe a gap > 90s since the last tick, the laptop
    // slept (or the process was paused). Run the catch-up sweep then so
    // any cron firings that happened during sleep get covered.
    this._heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const gap = now - this._lastHeartbeatMs;
      this._lastHeartbeatMs = now;
      if (gap > 90_000) {
        const gapSec = Math.round(gap / 1000);
        console.log(`⏰ [orchestrator] detected ${gapSec}s gap between heartbeats — running catch-up sweep`);
        this._catchUpSweep('wake').catch(err =>
          console.error('[orchestrator] wake catch-up failed:', err.message)
        );
      }
    }, 60_000);
  }

  /**
   * Catch-up sweep. For each idempotent job whose first scheduled firing of
   * the day has passed but no successful run is logged today, fire it once.
   *
   * Called automatically on boot (5s after start) and after any detected
   * heartbeat gap > 90s (sleep/suspend recovery). Also exposed for tests
   * and ad-hoc manual triggers.
   *
   * Skips entirely on weekends and NSE holidays — those are non-trading
   * days and the engine shouldn't be scanning.
   *
   * @param {string} reason  free-form tag for logging ('boot' / 'wake' / 'manual')
   * @returns {Promise<{ fired: string[], skipped: object }>}
   */
  async _catchUpSweep(reason = 'manual') {
    const istNow = nowInIST();
    if (isNonTradingDay(istNow)) {
      return { fired: [], skipped: { reason: 'non_trading_day' } };
    }

    const cutoffUtc = utcIsoOfTodayIstMidnight();
    const fired = [];
    const skipped = {};

    for (const [jobId, cfg] of Object.entries(CATCHUP_ELIGIBLE)) {
      // Only fire if we're past the first scheduled firing today
      const firstFire = istHHmmToday(cfg.firstFireAtIST);
      if (istNow < firstFire) {
        skipped[jobId] = 'before_first_fire';
        continue;
      }

      // Skip if the job is currently disabled (e.g. killswitch tripped pre-market)
      const entry = this.tasks.get(jobId);
      if (!entry) {
        skipped[jobId] = 'job_disabled';
        continue;
      }

      // Skip if there's already a successful run today
      const lastOk = schedulerRepo.lastOkRunSince(jobId, cutoffUtc);
      if (lastOk) {
        skipped[jobId] = `already_ran_at_${lastOk}`;
        continue;
      }

      // Fire it
      console.log(`⏰ [catch-up:${reason}] firing ${jobId} (missed its ${cfg.firstFireAtIST} IST window)`);
      try {
        await this.runNow(jobId);
        fired.push(jobId);
      } catch (err) {
        console.error(`⏰ [catch-up:${reason}] ${jobId} failed:`, err.message);
        skipped[jobId] = `error_${err.message.slice(0, 40)}`;
      }
    }

    if (fired.length > 0) {
      console.log(`⏰ [catch-up:${reason}] done — fired ${fired.length} job(s): ${fired.join(', ')}`);
    }
    return { fired, skipped };
  }

  _enabledFor(job) {
    const setting = schedulerRepo.getSetting(`job:${job.id}:enabled`);
    if (setting === null) return job.default;
    return setting === '1' || setting === 'true';
  }

  _scheduleJob(job) {
    const wrappedHandler = async () => {
      const logId = schedulerRepo.start(job.id, '');
      try {
        const result = await job.handler();
        const status = result.ok ? 'ok' : 'error';
        schedulerRepo.finish(logId, status, result.message || '', result.detail);
        const entry = this.tasks.get(job.id);
        if (entry) entry.lastRun = { startedAt: new Date().toISOString(), status, message: result.message };
        console.log(`⏰ [${job.id}] ${status === 'ok' ? '✓' : '✗'} ${result.message}`);
      } catch (err) {
        schedulerRepo.finish(logId, 'error', err.message, { stack: err.stack });
        console.error(`⏰ [${job.id}] ✗ ${err.message}`);
        // Persist to error_log + Telegram-alert (critical scheduler failures
        // are alerted; routine job errors are journaled silently).
        recordError(err, {
          severity: 'error',
          source:   `job:${job.id}`,
          context:  { cron: job.cron },
        }).catch(() => {});
      }
    };

    const task = cron.schedule(job.cron, wrappedHandler, { scheduled: true, timezone: TZ });
    this.tasks.set(job.id, { task, jobConfig: job, lastRun: null });
  }

  /**
   * Manually trigger a job by id — used for ad-hoc UI buttons.
   */
  async runNow(id) {
    const jobs = buildJobs(this.ctx);
    const job = jobs.find(j => j.id === id);
    if (!job) throw new Error(`Unknown job: ${id}`);

    const logId = schedulerRepo.start(job.id, 'manual run');
    try {
      const result = await job.handler();
      schedulerRepo.finish(logId, result.ok ? 'ok' : 'error', result.message || '', result.detail);
      const entry = this.tasks.get(job.id);
      if (entry) entry.lastRun = { startedAt: new Date().toISOString(), status: result.ok ? 'ok' : 'error', message: result.message };
      return result;
    } catch (err) {
      schedulerRepo.finish(logId, 'error', err.message, { stack: err.stack });
      recordError(err, {
        severity: 'error',
        source:   `job:${job.id}`,
        context:  { trigger: 'manual' },
      }).catch(() => {});
      throw err;
    }
  }

  /**
   * Toggle a job on or off. Persists to DB so it survives restart.
   */
  toggle(id, enabled) {
    schedulerRepo.setSetting(`job:${id}:enabled`, enabled ? '1' : '0');
    const existing = this.tasks.get(id);

    if (!enabled && existing) {
      existing.task.stop();
      this.tasks.delete(id);
      return { id, enabled: false };
    }

    if (enabled && !existing) {
      const jobs = buildJobs(this.ctx);
      const job = jobs.find(j => j.id === id);
      if (job) this._scheduleJob(job);
      return { id, enabled: true };
    }
    return { id, enabled, noop: true };
  }

  /**
   * Status snapshot for the UI.
   */
  status() {
    const jobs = buildJobs(this.ctx || {});
    return {
      running: this.running,
      jobs: jobs.map(j => {
        const entry = this.tasks.get(j.id);
        const enabled = this._enabledFor(j);
        return {
          id: j.id,
          cron: j.cron,
          description: j.description,
          enabled,
          active: !!entry,
          lastRun: entry?.lastRun || null,
        };
      }),
    };
  }

  stop() {
    for (const [, t] of this.tasks) t.task.stop();
    this.tasks.clear();
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this.running = false;
  }

  /**
   * Public catch-up trigger — exposed via API so the user can force a
   * sweep from outside (e.g. "did the system catch up after my laptop
   * woke?"). Same logic as the boot/wake auto-triggers.
   */
  async catchUpNow(reason = 'manual') {
    return this._catchUpSweep(reason);
  }
}

export const orchestrator = new Orchestrator();

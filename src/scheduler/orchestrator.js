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
import {
  jobPreMarket, jobMarkToMarket, jobExitCycle,
  jobEodSnapshot, jobEarningsRefresh, jobWeeklyBacktest,
  jobRiskKillswitch, jobStaleTradeAudit, jobDailySummary,
} from './jobs.js';

const TZ = 'Asia/Kolkata';

/**
 * Job registry. Each entry is one cron-triggered task.
 * `handler(ctx)` is the async work. `default` is the at-rest enabled state.
 */
function buildJobs(ctx) {
  return [
    {
      id: 'pre-market',
      cron: '0 9 * * 1-5',
      description: 'Generate today\'s picks at 09:00 IST and auto-track survivors as paper trades',
      default: true,
      handler: () => jobPreMarket(ctx),
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
    this.running = false;
  }
}

export const orchestrator = new Orchestrator();

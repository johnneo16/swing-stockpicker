import 'dotenv/config';
import './src/logger.js';   // M1.3: install structured-logging console shim early
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { batchFetchStocks, fetchMarketIndex } from './src/engine/dataFetcher.js';
import { scoreStock, rankAndFilterTrades } from './src/engine/scoringEngine.js';
import { calculatePortfolioSummary, CONFIG, getCapitalForClass } from './src/engine/riskEngine.js';
import STOCK_UNIVERSE from './src/engine/stockUniverse.js';
import ETF_UNIVERSE from './src/engine/etfUniverse.js';

// New persistence + lifecycle modules (Phase 1+2 build-out)
import { dbHealthCheck, scansRepo, backtestRepo, tradesRepo } from './src/persistence/db.js';
import {
  openPosition, listOpenPositions, markAllToMarket,
  portfolioSummary as livePortfolioSummary, fetchLastPrice,
} from './src/lifecycle/positionTracker.js';
import { runExitCycle, evaluateExit } from './src/lifecycle/exitEngine.js';
import {
  refreshEarningsCalendar, isEarningsBlackout, listUpcomingEvents,
} from './src/intelligence/earningsFetcher.js';
import { refreshRegime, getRegime, regimeBias } from './src/intelligence/regimeDetector.js';
import { orchestrator } from './src/scheduler/orchestrator.js';
import { picksRepo, schedulerRepo, db } from './src/persistence/db.js';
import { todayStatus, upcomingHolidays, nextTradingDays } from './src/scheduler/jobs.js';
import { isAngelOneConfigured } from './src/engine/angelOneProvider.js';
import { portfolioRiskSnapshot } from './src/intelligence/portfolioRisk.js';
import { recordError, recentErrors } from './src/alerts/errorJournal.js';
import { isTelegramConfigured } from './src/alerts/telegram.js';
import fs from 'fs';

const SERVER_BOOT_AT = Date.now();

// Top-level safety net for errors that escape every other catch.
// Both handlers persist the error to error_log (DB-backed journal),
// emit a CRITICAL Telegram alert if configured, and let the process
// continue running. uncaughtException defaults to terminating the
// process — we intentionally swallow it, because launchd KeepAlive
// will respawn us anyway and an in-memory restart preserves the
// orchestrator's cron state for the rest of the trading day.
process.on('uncaughtException', (err) => {
  recordError(err, { severity: 'critical', source: 'uncaught', alert: true })
    .catch(() => { /* journal itself failed; no more recovery available */ });
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  recordError(err, { severity: 'critical', source: 'unhandledRejection', alert: true })
    .catch(() => {});
});

const app = express();
const PORT = process.env.PORT || 51280;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// Serve Vite production build
app.use(express.static(path.join(__dirname, 'dist')));

// Cache for scan results
let scanCache = {
  data: null,
  timestamp: 0,
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
};

// ETF scan cache (separate from stocks)
let etfScanCache = {
  data: null,
  timestamp: 0,
  CACHE_TTL: 5 * 60 * 1000,
};

// Market context cache
let marketContextCache = {
  data: null,
  timestamp: 0,
};

// Scheduler state
const scheduler = {
  enabled: true,
  intervalMs: 30 * 60 * 1000, // 30 minutes
  lastScan: null,
  nextScan: null,
  scanCount: 0,
  timerId: null,
};

// ============================================================
// NSE Market Hours Logic
// ============================================================

function isNSEMarketHours() {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Skip weekends
  if (day === 0 || day === 6) return false;

  // NSE: 9:00 AM (pre-market) to 3:45 PM (post close buffer)
  // Pre-market at 9:00, market opens 9:15, closes 3:30
  const marketOpen = 9 * 60;       // 9:00 AM
  const marketClose = 15 * 60 + 45; // 3:45 PM

  return timeInMinutes >= marketOpen && timeInMinutes <= marketClose;
}

function getNextScanTime() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // If during market hours, next scan in 30 min
  if (isNSEMarketHours()) {
    return new Date(now.getTime() + scheduler.intervalMs);
  }

  // If before market today (weekday)
  if (day >= 1 && day <= 5 && timeInMinutes < 9 * 60) {
    const next = new Date(ist);
    next.setHours(9, 0, 0, 0);
    return next;
  }

  // Find next weekday at 9:00 AM
  const daysUntilNext = day === 5 ? 3 : day === 6 ? 2 : 1;
  const next = new Date(ist);
  next.setDate(next.getDate() + daysUntilNext);
  next.setHours(9, 0, 0, 0);
  return next;
}

// ============================================================
// Core Scan Logic
// ============================================================

async function runScan(force = false, capital = null, scanOptions = {}) {
  const totalCapital = capital || CONFIG.TOTAL_CAPITAL;
  const now = Date.now();

  // Check cache — but skip cache if scan was requested with custom filtering
  // (e.g. orchestrator passing excludeSymbols for a portfolio-aware scan,
  // or maxResults higher than default)
  const hasCustomFilters = (scanOptions.excludeSymbols && scanOptions.excludeSymbols.size > 0)
                        || (scanOptions.maxResults && scanOptions.maxResults !== 5);
  if (!force && !hasCustomFilters && scanCache.data && (now - scanCache.timestamp) < scanCache.CACHE_TTL) {
    return { ...scanCache.data, cached: true, cachedAt: new Date(scanCache.timestamp).toISOString() };
  }

  console.log(`\n[${new Date().toISOString()}] 🔍 Starting market scan...`);

  // 1. Fetch market context
  let marketContext = null;
  try {
    const nifty = await fetchMarketIndex('^NSEI');
    if (nifty) {
      marketContext = {
        niftyTrend: nifty.changePercent > 0.3 ? 'bullish' : nifty.changePercent < -0.3 ? 'bearish' : 'neutral',
        marketMood: nifty.changePercent > 0.5 ? 'Bullish' : nifty.changePercent < -0.5 ? 'Bearish' : 'Neutral',
        niftyPrice: nifty.price,
        niftyChange: nifty.changePercent,
      };
      marketContextCache.data = marketContext;
      marketContextCache.timestamp = now;
    }
  } catch (e) {
    console.log('  ⚠️ Could not fetch market context');
  }

  // 2. Fetch price + fundamentals concurrently (two parallel pipelines)
  const stocksData = await batchFetchStocks(STOCK_UNIVERSE, 300);
  console.log(`  📊 Fetched data for ${stocksData.length}/${STOCK_UNIVERSE.length} stocks`);

  // 3. Score each stock (now with market context)
  const scored = stocksData.map(stockData => {
    try {
      return scoreStock(stockData, marketContext, totalCapital);
    } catch (err) {
      console.error(`  ❌ Error scoring ${stockData.symbol}:`, err.message);
      return null;
    }
  }).filter(Boolean);
  console.log(`  🧠 Scored ${scored.length} stocks`);

  // 4. Rank and filter (orchestrator can pass excludeSymbols + maxResults)
  const result = rankAndFilterTrades(scored, totalCapital, {
    maxResults:     scanOptions.maxResults     ?? 5,
    excludeSymbols: scanOptions.excludeSymbols ?? new Set(),
  });

  // 4b. Enrich each trade with upcoming-event flags (earnings blackout etc.)
  let blackoutCount = 0;
  for (const t of result.trades) {
    const event = isEarningsBlackout(t.symbol, 14, ['earnings']);
    if (event) {
      t.upcomingEvent = event;
      // Hard-block if earnings within 2 days; warn otherwise
      if (event.daysUntil <= 2) {
        t.eventBlackout = true;
        blackoutCount++;
      }
    }
  }
  if (blackoutCount > 0) {
    console.log(`  ⚠ ${blackoutCount} trade(s) flagged as earnings-blackout`);
  }

  console.log(`  ✅ Selected ${result.trades.length} trades (capital: ₹${totalCapital.toLocaleString('en-IN')})`);

  if (result.trades.length > 0) {
    result.trades.forEach(t => {
      const flag = t.eventBlackout ? ' 🚨EARNINGS' : t.upcomingEvent ? ` (earnings d+${t.upcomingEvent.daysUntil})` : '';
      console.log(`     📌 ${t.symbol} — Score: ${t.confidenceScore}, Entry: ₹${t.entryPrice}, R:R 1:${t.riskRewardRatio}${flag}`);
    });
  }

  // 5. Cache + persist
  scanCache.data = result;
  scanCache.timestamp = now;
  scheduler.lastScan = new Date().toISOString();
  scheduler.scanCount++;

  // Persist scan to DB for historical analysis (best-effort, non-blocking)
  try {
    scansRepo.save({
      capital: totalCapital,
      scanType: 'stock',
      totalPicks: scored.length,
      trades: result.trades,
      marketContext,
    });
  } catch (e) {
    console.warn('  ⚠ Failed to persist scan:', e.message);
  }

  return {
    ...result,
    cached: false,
    scannedAt: new Date().toISOString(),
    stocksAnalyzed: stocksData.length,
    marketContext,
  };
}

// (Auto-refresh scheduler — now handled by src/scheduler/orchestrator.js)

// ============================================================
// API Endpoints
// ============================================================

// Timeout wrapper — ensures Render's 30s proxy limit is never breached
const SCAN_TIMEOUT_MS = 25000;
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Scan timed out after ${ms / 1000}s`)), ms)),
  ]);
}

/**
 * GET /api/scan — Run full market scan
 */
app.get('/api/scan', async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const capital = req.query.capital ? parseInt(req.query.capital, 10) : null;

    // If stale cache exists and scan times out, return stale cache rather than 503
    const result = await withTimeout(runScan(force, capital || undefined), SCAN_TIMEOUT_MS)
      .catch(err => {
        console.warn('⚠️ Scan timeout:', err.message);
        if (scanCache.data) {
          console.log('  ↩ Returning stale cache');
          return { ...scanCache.data, cached: true, timedOut: true, cachedAt: new Date(scanCache.timestamp).toISOString() };
        }
        throw err; // no cache at all — propagate
      });

    res.json(result);
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ error: 'Scan failed', message: error.message });
  }
});

/**
 * GET /api/market-overview — Market indices
 */
app.get('/api/market-overview', async (req, res) => {
  try {
    const [nifty, bankNifty, sensex] = await Promise.all([
      fetchMarketIndex('^NSEI'),
      fetchMarketIndex('^NSEBANK'),
      fetchMarketIndex('^BSESN'),
    ]);

    const marketMood = nifty
      ? (nifty.changePercent > 0.5 ? 'Bullish'
        : nifty.changePercent < -0.5 ? 'Bearish'
        : 'Neutral')
      : 'Unknown';

    res.json({
      indices: { nifty50: nifty, bankNifty: bankNifty, sensex: sensex },
      marketMood,
      isMarketOpen: isNSEMarketHours(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Market overview error:', error);
    res.status(500).json({ error: 'Failed to fetch market overview' });
  }
});

/**
 * GET /api/portfolio — Portfolio summary
 */
app.get('/api/portfolio', (req, res) => {
  const trades = scanCache.data?.trades || [];
  const portfolio = calculatePortfolioSummary(trades);
  res.json({
    portfolio,
    activeTrades: trades.map(t => ({
      symbol: t.symbol,
      name: t.name,
      entryPrice: t.entryPrice,
      stopLoss: t.stopLoss,
      targetPrice: t.targetPrice,
      quantity: t.quantity,
      capitalRequired: t.capitalRequired,
      confidenceScore: t.confidenceScore,
    })),
  });
});

/**
 * runEtfScan — core ETF scan (extracted to module scope so the orchestrator
 * can call it via `runEtfScan` in its context, just like `runScan` for stocks).
 *
 * Same signature as runScan: (force, capital, scanOptions) → { trades, ... }
 * scanOptions: { excludeSymbols, maxResults } — orchestrator uses these for
 * portfolio-aware backfill (avoid re-suggesting already-open ETFs).
 */
async function runEtfScan(force = false, capital = null, scanOptions = {}) {
  const totalCapital = capital || CONFIG.TOTAL_CAPITAL;
  const now = Date.now();

  const hasCustomFilters = (scanOptions.excludeSymbols && scanOptions.excludeSymbols.size > 0)
                       || (scanOptions.maxResults && scanOptions.maxResults !== 5);
  if (!force && !hasCustomFilters && etfScanCache.data && (now - etfScanCache.timestamp) < etfScanCache.CACHE_TTL) {
    return { ...etfScanCache.data, cached: true, cachedAt: new Date(etfScanCache.timestamp).toISOString() };
  }

  console.log(`\n[${new Date().toISOString()}] 🔍 Starting ETF scan...`);
  const etfData = await batchFetchStocks(ETF_UNIVERSE, 300);
  console.log(`  📊 Fetched data for ${etfData.length}/${ETF_UNIVERSE.length} ETFs`);

  const scored = etfData.map(d => {
    try { return scoreStock(d, null, totalCapital); }
    catch (err) { console.error(`  ❌ Error scoring ETF ${d.symbol}:`, err.message); return null; }
  }).filter(Boolean);

  const result = rankAndFilterTrades(scored, totalCapital, {
    maxSectorExposure: 5,
    maxResults:        scanOptions.maxResults     ?? 5,
    excludeSymbols:    scanOptions.excludeSymbols ?? new Set(),
  });
  console.log(`  ✅ Selected ${result.trades.length} ETF trades`);

  etfScanCache.data = result;
  etfScanCache.timestamp = now;

  return {
    ...result,
    cached: false,
    scannedAt: new Date().toISOString(),
    etfsAnalyzed: etfData.length,
  };
}

/**
 * GET /api/scan-etf — Run ETF market scan
 */
app.get('/api/scan-etf', async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const capital = req.query.capital ? parseInt(req.query.capital, 10) : null;

    const result = await withTimeout(runEtfScan(force, capital), SCAN_TIMEOUT_MS)
      .catch(err => {
        console.warn('⚠️ ETF scan timeout:', err.message);
        if (etfScanCache.data) return { ...etfScanCache.data, cached: true, timedOut: true };
        throw err;
      });

    res.json(result);
  } catch (error) {
    console.error('ETF scan error:', error);
    res.status(500).json({ error: 'ETF scan failed', message: error.message });
  }
});

/**
 * GET /api/calendar/today — diagnostic: is today a trading day? why/why not?
 *   Also includes the next 5 trading days + upcoming holidays in next 30 days.
 */
app.get('/api/calendar/today', (req, res) => {
  const status = todayStatus();
  res.json({
    ...status,
    nextTradingDays: nextTradingDays(5),
    upcomingHolidays: upcomingHolidays(30),
  });
});

/**
 * GET /api/scheduler/status — orchestrator state, all jobs + last-run info
 */
app.get('/api/scheduler/status', (req, res) => {
  res.json({
    ...orchestrator.status(),
    isMarketOpen:    isNSEMarketHours(),
    nextScan:        getNextScanTime().toISOString(),
    legacyScanCount: scheduler.scanCount,
    settings:        schedulerRepo.allSettings(),
  });
});

/**
 * POST /api/scheduler/jobs/:id/run — fire a job manually
 */
app.post('/api/scheduler/jobs/:id/run', async (req, res) => {
  try {
    const result = await orchestrator.runNow(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/scheduler/jobs/:id/toggle — enable/disable a job
 *   body: { enabled: bool }
 */
app.post('/api/scheduler/jobs/:id/toggle', (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    res.json(orchestrator.toggle(req.params.id, enabled));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/scheduler/log — recent scheduler runs (any job)
 *   ?limit=50
 */
app.get('/api/scheduler/log', (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit || '50', 10));
  res.json({ runs: schedulerRepo.recent(limit) });
});

/**
 * GET /api/errors — recent rows from the error journal.
 *   ?limit=N (default 50, max 500)
 *   ?severity=critical|error|warning
 * Backs the Health-tab error widget and ad-hoc debugging.
 */
app.get('/api/errors', (req, res) => {
  const limit    = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const severity = req.query.severity || null;
  res.json({
    ok: true,
    telegramConfigured: isTelegramConfigured(),
    errors: recentErrors(limit, severity),
  });
});

/**
 * POST /api/scheduler/killswitch/reset — clear killswitch trip
 */
app.post('/api/scheduler/killswitch/reset', (req, res) => {
  schedulerRepo.setSetting('job:pre-market:enabled', '1');
  schedulerRepo.setSetting('killswitch:tripped_at', '');
  schedulerRepo.setSetting('killswitch:reason', '');
  orchestrator.toggle('pre-market', true);
  res.json({ ok: true, message: 'Killswitch reset, pre-market job re-enabled' });
});

/**
 * GET /api/picks/today — today's curated picks (auto-tracked + blocked)
 */
app.get('/api/picks/today', (req, res) => {
  const assetClass = req.query.assetClass || null;   // 'stock' | 'etf' | null = all
  const picks = picksRepo.forToday(assetClass);
  res.json({ date: new Date().toISOString().slice(0, 10), assetClass, picks });
});

/**
 * GET /api/picks/recent — recent days' pick counts
 */
app.get('/api/picks/recent', (req, res) => {
  const limit = Math.min(60, parseInt(req.query.limit || '14', 10));
  res.json({ days: picksRepo.recentDays(limit) });
});

/**
 * GET /api/picks/:date — picks for a given date (YYYY-MM-DD)
 */
app.get('/api/picks/:date', (req, res) => {
  const picks = picksRepo.forDate(req.params.date);
  res.json({ date: req.params.date, picks });
});

// ============================================================
// Phase 1+2 — Paper Trading, Lifecycle, Backtest Endpoints
// ============================================================

/**
 * GET /api/health/db — DB health & schema check
 */
app.get('/api/health/db', (req, res) => {
  try { res.json(dbHealthCheck()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/**
 * GET /api/health/macro — aggregated platform health snapshot
 *   server uptime, memory, DB file size, scheduler last-firings, killswitch,
 *   data counts, NSE market status.
 */
app.get('/api/health/macro', async (req, res) => {
  try {
    const dbInfo = dbHealthCheck();
    let dbSizeBytes = 0;
    try { dbSizeBytes = fs.statSync(dbInfo.path).size; } catch (_) {}

    const mem = process.memoryUsage();
    const sched = orchestrator.status();
    const killswitchTrippedAt = schedulerRepo.getSetting('killswitch:tripped_at') || null;
    const killswitchReason    = schedulerRepo.getSetting('killswitch:reason') || null;

    // Portfolio risk snapshot (correlation + VaR) — async, hits Yahoo
    let portfolioRisk = null;
    try {
      const openRows = db.prepare(
        `SELECT symbol, capital FROM trades WHERE status='open' AND mode='paper'`
      ).all();
      portfolioRisk = await portfolioRiskSnapshot(openRows, 50000);
    } catch (e) {
      portfolioRisk = { error: e.message };
    }

    // Lightweight data counts (single-row aggregate queries — fast)
    const counts = {
      openPositions:   db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE status='open'`).get().n,
      closedTrades:    db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE status='closed'`).get().n,
      backtests:       db.prepare(`SELECT COUNT(*) AS n FROM backtest_runs`).get().n,
      picksToday:      db.prepare(`SELECT COUNT(*) AS n FROM daily_picks WHERE pick_date = date('now')`).get().n,
      reflections:     db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE reflection_json IS NOT NULL`).get().n,
      schedulerRuns24h: db.prepare(`SELECT COUNT(*) AS n FROM scheduler_log WHERE started_at >= datetime('now','-1 day')`).get().n,
    };

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      server: {
        uptimeSec:  Math.round((Date.now() - SERVER_BOOT_AT) / 1000),
        bootedAt:   new Date(SERVER_BOOT_AT).toISOString(),
        nodeVersion: process.version,
        pid:        process.pid,
        memory: {
          rssMb:      +(mem.rss / 1024 / 1024).toFixed(1),
          heapUsedMb: +(mem.heapUsed / 1024 / 1024).toFixed(1),
          heapTotalMb:+(mem.heapTotal / 1024 / 1024).toFixed(1),
        },
      },
      database: {
        path:       dbInfo.path,
        sizeMb:     +(dbSizeBytes / 1024 / 1024).toFixed(2),
        tableCount: dbInfo.tables.length,
      },
      market: {
        nseOpen:    isNSEMarketHours(),
        ...todayStatus(),
      },
      scheduler: {
        running:    sched.running,
        jobCount:   sched.jobs.length,
        jobs:       sched.jobs.map(j => ({
          id: j.id, enabled: j.enabled, active: j.active,
          lastRun: j.lastRun, cron: j.cron,
        })),
      },
      killswitch: {
        tripped: !!killswitchTrippedAt,
        trippedAt: killswitchTrippedAt,
        reason: killswitchReason,
      },
      providers: {
        angelOneConfigured: isAngelOneConfigured(),
      },
      portfolioRisk,
      counts,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/positions/open — open a paper position from a scored trade payload
 *   body: { trade: {...}, mode?: 'paper'|'live' }
 */
app.post('/api/positions/open', async (req, res) => {
  try {
    const { trade, mode = 'paper' } = req.body || {};
    if (!trade?.symbol) return res.status(400).json({ error: 'trade.symbol is required' });
    const opened = await openPosition(trade, mode);
    res.json({ ok: true, position: opened });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/positions — list open positions (does NOT fetch fresh prices)
 *   ?mode=paper|live
 */
app.get('/api/positions', (req, res) => {
  const mode = req.query.mode === 'live' ? 'live' : 'paper';
  const assetClass = req.query.assetClass || null;
  res.json({ mode, assetClass, positions: listOpenPositions(mode, assetClass) });
});

/**
 * POST /api/positions/refresh — mark-to-market all open positions
 */
app.post('/api/positions/refresh', async (req, res) => {
  try {
    const mode = req.body?.mode === 'live' ? 'live' : 'paper';
    const summaries = await markAllToMarket(mode);
    res.json({ mode, positions: summaries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/positions/exit-cycle — evaluate exit rules and apply actions
 */
app.post('/api/positions/exit-cycle', async (req, res) => {
  try {
    const mode = req.body?.mode === 'live' ? 'live' : 'paper';
    const rules = req.body?.rules || {};
    // Always refresh first
    await markAllToMarket(mode);
    const result = await runExitCycle(mode, rules);
    res.json({ mode, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/positions/cards — currently-held positions in TradeCard format.
 *
 * This is the Dashboard's primary data source. When a position closes
 * (status='closed'), it's automatically excluded — so closed trades
 * disappear from the dashboard view without needing a refresh.
 *
 * Each card combines:
 *   - Original scored-trade payload from daily_picks (technicalReasoning,
 *     whyThisWorks, scoreBreakdown, chartData, fundamentals, etc.)
 *   - Current live state from positions table (CMP, unrealized PnL, R-multiple)
 *   - Trade metadata (current stop after BE/trail, held days, lifecycle flags)
 *
 * Fallback path: if no daily_picks row exists for the symbol (e.g. position
 * opened directly via API), reconstruct minimal card from trades.metadata.
 */
app.get('/api/positions/cards', (req, res) => {
  const mode = req.query.mode === 'live' ? 'live' : 'paper';
  const assetClass = req.query.assetClass || null;
  const positions = listOpenPositions(mode, assetClass);

  const getPayloadStmt = db.prepare(`
    SELECT payload_json FROM daily_picks
    WHERE symbol = ? AND auto_tracked = 1
    ORDER BY pick_date DESC LIMIT 1
  `);

  const cards = positions.map(p => {
    let originalPayload = {};
    const pickRow = getPayloadStmt.get(p.symbol);
    if (pickRow?.payload_json) {
      try { originalPayload = JSON.parse(pickRow.payload_json); } catch (_) {}
    }

    // Synthesize day-change vs entry (since positions don't track prev-close)
    const dayChange = p.unrealizedPct ?? 0;

    return {
      // Original scored payload as the base (preserves technicalReasoning,
      // whyWorks, whyFails, chartData, fundamentals, scoreBreakdown, signals, etc.)
      ...originalPayload,

      // Identity (overrides in case daily_picks payload is stale)
      symbol:   p.symbol,
      name:     p.name,
      sector:   p.sector,
      setupType: p.setupType,

      // Trade economics — use entry from trades table (source of truth)
      entryPrice:      p.entryPrice,
      stopLoss:        p.currentStop,        // current — may have moved to BE
      initialStop:     p.initialStop,
      targetPrice:     p.target,
      quantity:        p.quantity,
      capitalRequired: p.capital,
      riskAmount:      p.riskAmount,
      confidenceScore: p.confidence,
      estimatedDays:   p.estimatedDays,

      // Live state
      currentMarketPrice: p.lastPrice ?? p.entryPrice,
      dayChange,
      unrealizedPnl:      p.unrealizedPnl,
      unrealizedPct:      p.unrealizedPct,
      rMultiple:          p.rMultiple,
      heldDays:           p.heldDays,
      distanceToStopPct:   p.distanceToStopPct,
      distanceToTargetPct: p.distanceToTargetPct,

      // Lifecycle flags
      isHolding:    true,
      tradeId:      p.id,
      beMoved:      p.beMoved,
      partialTaken: p.partialTaken,
      trailActive:  p.trailActive,

      // R:R from original payload, computed if missing
      riskRewardRatio: originalPayload.riskRewardRatio
        || (p.target - p.entryPrice) / (p.entryPrice - p.initialStop || 1),
    };
  });

  res.json({ mode, count: cards.length, cards });
});

/**
 * GET /api/equity/today — today's simple P&L summary
 *
 * Returns broker-app-style "today's P&L" that matches what your trading
 * platform shows:
 *   - dayPnlOpen:    Σ (last_price − prev_close) × quantity over open positions
 *   - dayPnlClosed:  Σ realized P&L of trades closed today
 *   - dayPnlTotal:   dayPnlOpen + dayPnlClosed
 *   - dayPnlPct:     dayPnlTotal as % of deployed capital
 *
 * If a position has no prev_close yet (just opened today, never had MTM
 * during a prior session), it falls back to entry price → 0 contribution.
 */
app.get('/api/equity/today', (req, res) => {
  const mode = req.query.mode === 'live' ? 'live' : 'paper';
  const assetClass = req.query.assetClass || null;   // null = combined
  // Capital default is class-specific (₹50K stocks, ₹25K ETFs) unless overridden
  const capital = parseInt(req.query.capital || getCapitalForClass(assetClass || 'stock'), 10);

  // Open positions with their day-change data (filtered by asset class if given)
  const positions = listOpenPositions(mode, assetClass);
  let dayPnlOpen = 0;
  let positionsWithDayData = 0;
  const breakdown = [];

  for (const p of positions) {
    const pos = db.prepare(`SELECT prev_close, day_change_pct FROM positions WHERE trade_id = ?`).get(p.id);
    const prevClose = pos?.prev_close;
    const lastPrice = p.lastPrice;
    let dayContribution = 0;
    let dayChangePct = pos?.day_change_pct;
    if (prevClose && lastPrice) {
      dayContribution = (lastPrice - prevClose) * p.quantity;
      if (dayChangePct == null && prevClose > 0) {
        dayChangePct = ((lastPrice - prevClose) / prevClose) * 100;
      }
      positionsWithDayData++;
    }
    dayPnlOpen += dayContribution;
    breakdown.push({
      symbol:       p.symbol,
      lastPrice:    lastPrice,
      prevClose:    prevClose,
      dayChangePct: dayChangePct != null ? Math.round(dayChangePct * 100) / 100 : null,
      dayPnl:       Math.round(dayContribution * 100) / 100,
      quantity:     p.quantity,
    });
  }

  // Closed today — exit_date matches today (filtered by asset class if given)
  const today = new Date().toISOString().slice(0, 10);
  const closedQuery = assetClass
    ? `SELECT realized_pnl FROM trades
       WHERE status='closed' AND mode = ? AND asset_class = ? AND substr(exit_date, 1, 10) = ?`
    : `SELECT realized_pnl FROM trades
       WHERE status='closed' AND mode = ? AND substr(exit_date, 1, 10) = ?`;
  const closedToday = assetClass
    ? db.prepare(closedQuery).all(mode, assetClass, today)
    : db.prepare(closedQuery).all(mode, today);
  const dayPnlClosed = closedToday.reduce((s, t) => s + (t.realized_pnl || 0), 0);

  const dayPnlTotal = dayPnlOpen + dayPnlClosed;
  const deployedCapital = positions.reduce((s, p) => s + (p.capital || 0), 0);
  const dayPnlPct = deployedCapital > 0 ? (dayPnlTotal / deployedCapital) * 100 : 0;
  const dayPnlPctCapital = capital > 0 ? (dayPnlTotal / capital) * 100 : 0;

  // Unrealized "since entry" for context (different from day P&L)
  const unrealizedTotal = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);

  res.json({
    date:              today,
    mode,
    assetClass,
    capital,
    deployedCapital,
    positionCount:     positions.length,
    positionsWithDayData,
    dayPnlOpen:        Math.round(dayPnlOpen * 100) / 100,
    dayPnlClosed:      Math.round(dayPnlClosed * 100) / 100,
    dayPnlTotal:       Math.round(dayPnlTotal * 100) / 100,
    dayPnlPct:         Math.round(dayPnlPct * 100) / 100,            // % of deployed
    dayPnlPctCapital:  Math.round(dayPnlPctCapital * 100) / 100,     // % of total capital
    unrealizedTotal:   Math.round(unrealizedTotal * 100) / 100,
    closedTodayCount:  closedToday.length,
    breakdown,
  });
});

/**
 * GET /api/portfolio/live — aggregate paper portfolio summary from DB
 */
app.get('/api/portfolio/live', (req, res) => {
  const mode       = req.query.mode === 'live' ? 'live' : 'paper';
  const assetClass = req.query.assetClass || null;
  const capital    = parseInt(req.query.capital || getCapitalForClass(assetClass || 'stock'), 10);
  res.json({ mode, assetClass, ...livePortfolioSummary(mode, capital, assetClass) });
});

/**
 * GET /api/trades/history — recently closed trades for journal view
 */
app.get('/api/trades/history', (req, res) => {
  const mode  = req.query.mode === 'live' ? 'live' : 'paper';
  const assetClass = req.query.assetClass || null;
  const limit = Math.min(200, parseInt(req.query.limit || '50', 10));
  // Filter recent closed by class if requested (db query supports the column)
  const all = tradesRepo.getRecentClosed(mode, limit * 2);  // over-fetch to allow filter
  const filtered = assetClass ? all.filter(t => (t.asset_class || 'stock') === assetClass) : all;
  res.json({ mode, assetClass, trades: filtered.slice(0, limit) });
});

/**
 * GET /api/regime — current market regime snapshot (cached, refreshed if stale)
 */
app.get('/api/regime', async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const snap = await getRegime({ forceRefresh: force });
    res.json({ ...snap, bias: regimeBias(snap.regime) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/regime/refresh — force refresh regime snapshot
 */
app.post('/api/regime/refresh', async (req, res) => {
  try {
    const snap = await refreshRegime();
    res.json({ ok: true, ...snap, bias: regimeBias(snap.regime) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/events/refresh — refresh upcoming-events cache from NSE
 *   body: { daysAhead?: number }
 */
app.post('/api/events/refresh', async (req, res) => {
  try {
    const days = parseInt(req.body?.daysAhead || '14', 10);
    const result = await refreshEarningsCalendar({ daysAhead: days });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/events/upcoming — list upcoming events for the universe
 *   ?days=14&types=earnings,dividend
 */
app.get('/api/events/upcoming', (req, res) => {
  const days  = Math.min(60, parseInt(req.query.days || '14', 10));
  const types = req.query.types ? req.query.types.split(',') : null;
  res.json({ days, events: listUpcomingEvents(days, types) });
});

/**
 * GET /api/journal/stats — aggregate stats over closed paper/live trades
 *   ?mode=paper|live
 */
app.get('/api/journal/stats', (req, res) => {
  const mode = req.query.mode === 'live' ? 'live' : 'paper';
  const assetClass = req.query.assetClass || null;
  res.json(tradesRepo.journalStats(mode, assetClass));
});

/**
 * GET /api/backtests — list recent backtest runs
 */
app.get('/api/backtests', (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
  res.json({ runs: backtestRepo.list(limit) });
});

// Track in-progress backtests (only one at a time to avoid DB lock)
let _backtestInProgress = false;

/**
 * POST /api/backtests/run — trigger a backtest from the UI
 *   body: { startDate, endDate, threshold, universe, capital, volAdjustedSizing }
 */
app.post('/api/backtests/run', async (req, res) => {
  if (_backtestInProgress) {
    return res.status(409).json({ error: 'A backtest is already running. Try again in a few minutes.' });
  }
  _backtestInProgress = true;
  try {
    const body = req.body || {};
    const { runBacktest } = await import('./src/backtest/engine.js');
    const STOCK_UNIVERSE          = (await import('./src/engine/stockUniverse.js')).default;
    const STOCK_UNIVERSE_EXTENDED = (await import('./src/engine/stockUniverseExtended.js')).default;
    const universe = body.universe === 'extended' ? STOCK_UNIVERSE_EXTENDED : STOCK_UNIVERSE;

    const config = {
      startDate:        body.startDate || '2023-01-01',
      endDate:          body.endDate   || '2024-12-31',
      capital:          parseInt(body.capital || '50000', 10),
      scoreThreshold:   parseInt(body.threshold || '50', 10),
      includeLowConf:   body.includeLowConf === true,
      minRR:            parseFloat(body.minRR || '1.5'),
      maxConcurrent:    parseInt(body.maxConcurrent || '5', 10),
      maxPerSector:     parseInt(body.maxPerSector || '3', 10),
      maxHoldingDays:   parseInt(body.maxHoldingDays || '25', 10),
      volAdjustedSizing: body.volAdjustedSizing !== false,
      baseRiskPercent:  parseFloat(body.baseRiskPercent || '0.015'),
    };

    const runId = backtestRepo.start({
      startDate: config.startDate, endDate: config.endDate, capital: config.capital,
      universeSize: universe.length, config,
      notes: `UI-triggered, universe=${body.universe || 'default'}, vol=${config.volAdjustedSizing ? 'on' : 'off'}`,
    });

    // Respond immediately with runId; backtest runs in background
    res.status(202).json({ ok: true, runId, status: 'queued', message: 'Backtest started — poll /api/backtests/' + runId + ' for results.' });

    // Run + persist asynchronously (don't await — we already responded)
    (async () => {
      try {
        const result = await runBacktest(universe, config);
        backtestRepo.saveTrades(runId, result.trades);
        backtestRepo.finish(runId, {
          total_trades:    result.metrics.totalTrades,
          wins:            result.metrics.wins,
          losses:          result.metrics.losses,
          win_rate:        result.metrics.winRate,
          avg_win_pct:     result.metrics.avgWinPct,
          avg_loss_pct:    result.metrics.avgLossPct,
          expectancy_pct:  result.metrics.expectancyPct,
          total_return:    result.metrics.totalReturn,
          total_return_pct: result.metrics.totalReturnPct,
          max_drawdown_pct: result.metrics.maxDrawdownPct,
          sharpe_ratio:    result.metrics.sharpeRatio,
          profit_factor:   result.metrics.profitFactor,
        });
        console.log(`✓ Backtest #${runId} complete: ${result.metrics.totalTrades} trades, ${(result.metrics.winRate * 100).toFixed(1)}% win, +${result.metrics.totalReturnPct}% return`);
      } catch (e) {
        console.error(`✗ Backtest #${runId} failed:`, e.message);
      } finally {
        _backtestInProgress = false;
      }
    })();
  } catch (e) {
    _backtestInProgress = false;
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/backtests/status — is a backtest currently running?
 */
app.get('/api/backtests/status', (req, res) => {
  res.json({ inProgress: _backtestInProgress });
});

/**
 * GET /api/backtests/:id — full backtest run with trades
 */
app.get('/api/backtests/:id', (req, res) => {
  const run = backtestRepo.get(parseInt(req.params.id, 10));
  if (!run) return res.status(404).json({ error: 'Not found' });
  res.json(run);
});

// ============================================================
// SPA Catch-all (must be after all API routes)
// ============================================================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================================
// Start
// ============================================================

app.listen(PORT, () => {
  console.log(`\n🚀 Swing Stockpicker API running on http://localhost:${PORT}`);
  console.log(`   Endpoints:`);
  console.log(`   GET /api/scan              — Run market scan`);
  console.log(`   GET /api/market-overview    — Market indices`);
  console.log(`   GET /api/portfolio          — Portfolio summary`);
  console.log(`   GET /api/scheduler/status   — Scheduler state\n`);

  // ─────────────────────────────────────────────────────────────────────────
  // BACKGROUND ORCHESTRATOR — replaces the old setInterval scheduler.
  // Provides the jobs with shared context (scan/backtest functions, capital).
  // ─────────────────────────────────────────────────────────────────────────
  const STOCK_UNIVERSE_EXTENDED_PROMISE = import('./src/engine/stockUniverseExtended.js').then(m => m.default);

  setTimeout(async () => {
    try {
      const universeExt = await STOCK_UNIVERSE_EXTENDED_PROMISE;
      const { runBacktest } = await import('./src/backtest/engine.js');
      orchestrator.start({
        runScan,
        runEtfScan,
        capital: CONFIG.TOTAL_CAPITAL,
        runBacktest,
        backtestRepo,
        universe: universeExt,
      });

      // Warm caches once at startup (non-blocking)
      try { await refreshEarningsCalendar({ daysAhead: 14 }); } catch (e) { console.warn('📅 Earnings warm-up failed:', e.message); }
      try { await refreshRegime(); } catch (e) { console.warn('📊 Regime warm-up failed:', e.message); }
    } catch (err) {
      console.error('⏰ Orchestrator failed to start:', err.message);
    }
  }, 5000);
});

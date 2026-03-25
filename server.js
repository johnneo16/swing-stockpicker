import express from 'express';
import cors from 'cors';
import { batchFetchStocks, fetchMarketIndex } from './src/engine/dataFetcher.js';
import { scoreStock, rankAndFilterTrades } from './src/engine/scoringEngine.js';
import { calculatePortfolioSummary } from './src/engine/riskEngine.js';
import STOCK_UNIVERSE from './src/engine/stockUniverse.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Cache for scan results
let scanCache = {
  data: null,
  timestamp: 0,
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
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

async function runScan(force = false) {
  const now = Date.now();

  // Check cache
  if (!force && scanCache.data && (now - scanCache.timestamp) < scanCache.CACHE_TTL) {
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

  // 2. Fetch data + fundamentals for all stocks
  const stocksData = await batchFetchStocks(STOCK_UNIVERSE, 90, 4);
  console.log(`  📊 Fetched data for ${stocksData.length}/${STOCK_UNIVERSE.length} stocks`);

  // 3. Score each stock (now with market context)
  const scored = stocksData.map(stockData => {
    try {
      return scoreStock(stockData, marketContext);
    } catch (err) {
      console.error(`  ❌ Error scoring ${stockData.symbol}:`, err.message);
      return null;
    }
  }).filter(Boolean);
  console.log(`  🧠 Scored ${scored.length} stocks`);

  // 4. Rank and filter
  const result = rankAndFilterTrades(scored);
  console.log(`  ✅ Selected ${result.trades.length} trades`);

  if (result.trades.length > 0) {
    result.trades.forEach(t => {
      console.log(`     📌 ${t.symbol} — Score: ${t.confidenceScore}, Entry: ₹${t.entryPrice}, R:R 1:${t.riskRewardRatio}`);
    });
  }

  // 5. Cache
  scanCache.data = result;
  scanCache.timestamp = now;
  scheduler.lastScan = new Date().toISOString();
  scheduler.scanCount++;

  return {
    ...result,
    cached: false,
    scannedAt: new Date().toISOString(),
    stocksAnalyzed: stocksData.length,
    marketContext,
  };
}

// ============================================================
// Auto-Refresh Scheduler
// ============================================================

function startScheduler() {
  console.log('⏰ Auto-refresh scheduler started (every 30 min during NSE hours)');

  const check = async () => {
    scheduler.nextScan = getNextScanTime().toISOString();

    if (isNSEMarketHours()) {
      console.log(`\n⏰ [SCHEDULER] Market is open — running auto-scan...`);
      try {
        await runScan(true);
        console.log(`⏰ [SCHEDULER] Auto-scan complete. Next: ${scheduler.nextScan}`);
      } catch (err) {
        console.error('⏰ [SCHEDULER] Auto-scan failed:', err.message);
      }
    } else {
      const nextTime = getNextScanTime();
      console.log(`⏰ [SCHEDULER] Market closed. Next scan: ${nextTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    }
  };

  // Run check every 30 minutes
  scheduler.timerId = setInterval(check, scheduler.intervalMs);

  // Also run initial check after 5 seconds
  setTimeout(check, 5000);
}

// ============================================================
// API Endpoints
// ============================================================

/**
 * GET /api/scan — Run full market scan
 */
app.get('/api/scan', async (req, res) => {
  try {
    const force = req.query.refresh === 'true';
    const result = await runScan(force);
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
    const [nifty, bankNifty] = await Promise.all([
      fetchMarketIndex('^NSEI'),
      fetchMarketIndex('^NSEBANK'),
    ]);

    const marketMood = nifty
      ? (nifty.changePercent > 0.5 ? 'Bullish'
        : nifty.changePercent < -0.5 ? 'Bearish'
        : 'Neutral')
      : 'Unknown';

    res.json({
      indices: { nifty50: nifty, bankNifty: bankNifty },
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
 * GET /api/scheduler/status — Scheduler state
 */
app.get('/api/scheduler/status', (req, res) => {
  res.json({
    enabled: scheduler.enabled,
    intervalMinutes: scheduler.intervalMs / 60000,
    lastScan: scheduler.lastScan,
    nextScan: scheduler.nextScan,
    scanCount: scheduler.scanCount,
    isMarketOpen: isNSEMarketHours(),
  });
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

  // Start auto-refresh scheduler
  if (scheduler.enabled) {
    startScheduler();
  }
});

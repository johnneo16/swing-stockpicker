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

// Cache for scan results (avoid hammering Yahoo Finance)
let scanCache = {
  data: null,
  timestamp: 0,
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
};

/**
 * GET /api/scan
 * Run full market scan — fetch data, analyze, score, rank, filter
 */
app.get('/api/scan', async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === 'true';

    // Return cached results if fresh
    if (!forceRefresh && scanCache.data && (now - scanCache.timestamp) < scanCache.CACHE_TTL) {
      return res.json({
        ...scanCache.data,
        cached: true,
        cachedAt: new Date(scanCache.timestamp).toISOString(),
      });
    }

    console.log(`[${new Date().toISOString()}] Starting market scan...`);

    // 1. Fetch data for all stocks
    const stocksData = await batchFetchStocks(STOCK_UNIVERSE, 90, 5);
    console.log(`  Fetched data for ${stocksData.length}/${STOCK_UNIVERSE.length} stocks`);

    // 2. Score each stock
    const scored = stocksData.map(stockData => {
      try {
        return scoreStock(stockData);
      } catch (err) {
        console.error(`  Error scoring ${stockData.symbol}:`, err.message);
        return null;
      }
    }).filter(Boolean);
    console.log(`  Scored ${scored.length} stocks`);

    // 3. Rank and filter
    const result = rankAndFilterTrades(scored);
    console.log(`  Selected ${result.trades.length} trades`);

    // 4. Cache results
    scanCache.data = result;
    scanCache.timestamp = now;

    res.json({
      ...result,
      cached: false,
      scannedAt: new Date().toISOString(),
      stocksAnalyzed: stocksData.length,
    });
  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ error: 'Scan failed', message: error.message });
  }
});

/**
 * GET /api/market-overview
 * Market indices and sentiment overview
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
      indices: {
        nifty50: nifty,
        bankNifty: bankNifty,
      },
      marketMood,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Market overview error:', error);
    res.status(500).json({ error: 'Failed to fetch market overview' });
  }
});

/**
 * GET /api/portfolio
 * Portfolio summary (uses cached scan data)
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

app.listen(PORT, () => {
  console.log(`\n🚀 Swing Stockpicker API running on http://localhost:${PORT}`);
  console.log(`   Endpoints:`);
  console.log(`   GET /api/scan          — Run market scan`);
  console.log(`   GET /api/market-overview — Market indices`);
  console.log(`   GET /api/portfolio      — Portfolio summary\n`);
});

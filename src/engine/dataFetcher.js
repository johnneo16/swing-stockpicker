import yahooFinance from 'yahoo-finance2';
import { fetchFundamentals } from './fundamentalAnalysis.js';
import {
  fetchAngelOneHistorical,
  fetchAngelOneLTP,
  fetchAngelOneIndex,
  isAngelOneConfigured,
} from './angelOneProvider.js';

// Detect provider
const USE_ANGELONE = isAngelOneConfigured();
if (USE_ANGELONE) {
  console.log('📡 Data Provider: Angel One SmartAPI');
} else {
  console.log('📡 Data Provider: Yahoo Finance (set ANGELONE_* in .env for Angel One)');
}

// ============================================================
// Retry helper with exponential backoff
// ============================================================
async function withRetry(fn, maxRetries = 2, baseDelay = 2000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message?.includes('Too Many Requests') || err.message?.includes('429');
      if (attempt < maxRetries && is429) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`  ⏳ Rate limited, retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Fetches historical OHLCV data for an NSE stock.
 * Uses Angel One if configured, otherwise Yahoo Finance.
 */
export async function fetchStockData(symbol, days = 90) {
  if (USE_ANGELONE) {
    return fetchStockDataAngelOne(symbol, days);
  }
  return fetchStockDataYahoo(symbol, days);
}

// ============================================================
// Yahoo Finance Provider
// ============================================================

async function fetchStockDataYahoo(symbol, days = 90) {
  const yahooSymbol = `${symbol}.NS`;
  const period1 = new Date();
  period1.setDate(period1.getDate() - days);

  try {
    // Fetch historical first (most important), then quote separately
    const result = await withRetry(() =>
      yahooFinance.historical(yahooSymbol, {
        period1: period1.toISOString().split('T')[0],
        interval: '1d',
      })
    );

    if (!result || result.length === 0) return null;

    const quotes = result.map(q => ({
      date: q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
    }));

    // Try to get real-time quote (non-critical — ok if it fails)
    let quote = null;
    try {
      quote = await yahooFinance.quote(yahooSymbol);
    } catch {
      // Fall back to candle data silently
    }

    const lastCandle = quotes[quotes.length - 1];
    const currentPrice = quote?.regularMarketPrice || lastCandle.close;
    const previousClose = quote?.regularMarketPreviousClose
      || (quotes.length > 1 ? quotes[quotes.length - 2].close : lastCandle.close);
    const dayChange = quote?.regularMarketChangePercent
      ?? (previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);

    return {
      symbol,
      yahooSymbol,
      quotes,
      currentPrice,
      currentVolume: quote?.regularMarketVolume || lastCandle.volume,
      previousClose,
      dayChange,
      dayHigh: quote?.regularMarketDayHigh || lastCandle.high,
      dayLow: quote?.regularMarketDayLow || lastCandle.low,
    };
  } catch (error) {
    console.error(`[Yahoo] Failed to fetch ${symbol}:`, error.message);
    return null;
  }
}

// ============================================================
// Angel One Provider
// ============================================================

async function fetchStockDataAngelOne(symbol, days = 90) {
  try {
    return await fetchAngelOneHistorical(symbol, days);
  } catch (error) {
    console.error(`[AngelOne] Failed to fetch ${symbol}:`, error.message);
    return null;
  }
}

// ============================================================
// Market Index
// ============================================================

export async function fetchMarketIndex(symbol = '^NSEI') {
  if (USE_ANGELONE) {
    try {
      return await fetchAngelOneIndex(symbol);
    } catch { /* fall back to Yahoo */ }
  }

  try {
    const quote = await withRetry(() => yahooFinance.quote(symbol));
    return {
      name: quote.shortName || quote.longName || symbol,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent: quote.regularMarketChangePercent,
      dayHigh: quote.regularMarketDayHigh,
      dayLow: quote.regularMarketDayLow,
      volume: quote.regularMarketVolume,
    };
  } catch (error) {
    console.error(`[Yahoo] Failed to fetch index ${symbol}:`, error.message);
    return null;
  }
}

// ============================================================
// Batch Fetch — with rate limiting
// ============================================================

export async function batchFetchStocks(stocks, days = 90, concurrency = 2) {
  const results = [];

  for (let i = 0; i < stocks.length; i += concurrency) {
    const batch = stocks.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (s) => {
        const priceData = await fetchStockData(s.symbol, days);
        if (!priceData) return null;

        // Fundamentals via Yahoo (even if using Angel One for prices)
        let fundData = null;
        try {
          fundData = await fetchFundamentals(s.symbol);
        } catch { /* non-critical */ }

        return { ...priceData, fundamentals: fundData };
      })
    );

    for (let j = 0; j < batchResults.length; j++) {
      if (batchResults[j].status === 'fulfilled' && batchResults[j].value) {
        results.push({
          ...batchResults[j].value,
          name: batch[j].name,
          sector: batch[j].sector,
        });
      }
    }

    // Rate limit: wait 2s between batches for Yahoo, 300ms for Angel One
    if (i + concurrency < stocks.length) {
      await new Promise(r => setTimeout(r, USE_ANGELONE ? 300 : 2000));
    }
  }

  return results;
}

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

    const quotes = result.map(q => {
      const ratio = (q.adjClose && q.close && q.close > 0) ? q.adjClose / q.close : 1;
      return {
        date: q.date,
        open: q.open * ratio,
        high: q.high * ratio,
        low: q.low * ratio,
        close: q.adjClose || q.close,
        volume: q.volume,
      };
    });

    const lastCandle = quotes[quotes.length - 1];
    let currentPrice = lastCandle.close;
    let currentVolume = lastCandle.volume;
    let previousClose = quotes.length > 1 ? quotes[quotes.length - 2].close : lastCandle.close;
    let dayHigh = lastCandle.high;
    let dayLow = lastCandle.low;
    let dayChange = previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0;
    let quote = null; // declare at outer scope so return statement can access it

    // 1. Try Yahoo Finance quote
    try {
      quote = await yahooFinance.quote(yahooSymbol);
      if (quote && quote.regularMarketPrice) {
        currentPrice = quote.regularMarketPrice;
        currentVolume = quote.regularMarketVolume || currentVolume;
        previousClose = quote.regularMarketPreviousClose || previousClose;
        dayHigh = quote.regularMarketDayHigh || dayHigh;
        dayLow = quote.regularMarketDayLow || dayLow;
        dayChange = quote.regularMarketChangePercent ?? dayChange;
      }
    } catch {
      // 2. Fallback to Google Finance Web Scraper for real-time price (bypasses Yahoo 429 blocks)
      try {
        const { default: axios } = await import('axios');
        const cheerio = await import('cheerio');
        const url = `https://www.google.com/finance/quote/${symbol}:NSE`;
        const res = await axios.get(url, { 
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 
          timeout: 4000 
        });
        const $ = cheerio.load(res.data);
        const priceText = $('.YMlKec.fxKbKc').first().text();
        if (priceText) {
          const livePrice = parseFloat(priceText.replace(/,/g, '').replace('₹', '').trim());
          if (livePrice > 0) {
            currentPrice = livePrice;
            dayChange = ((currentPrice - previousClose) / previousClose) * 100;
          }
        }
      } catch (gErr) {
        // Silently fall back to EOD candle data
      }
    }

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
    // Fallback to Google Finance Web Scraper
    try {
      const gSymbol = symbol === '^NSEI' ? 'NIFTY_50:INDEXNSE' 
                    : symbol === '^BSESN' ? 'SENSEX:INDEXBOM' 
                    : symbol === '^NSEBANK' ? 'NIFTY_BANK:INDEXNSE' : null;
      if (gSymbol) {
        const { default: axios } = await import('axios');
        const cheerio = await import('cheerio');
        const url = `https://www.google.com/finance/quote/${gSymbol}`;
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 });
        const $ = cheerio.load(res.data);
        const priceText = $('.YMlKec.fxKbKc').first().text();
        const changeText = $('.JwB6zf').first().text(); // e.g. "+1.23%"
        
        if (priceText) {
          const price = parseFloat(priceText.replace(/,/g, '').replace('₹', '').trim());
          let changePercent = 0;
          if (changeText) {
             const match = changeText.match(/([+-]?[\d.]+)%/);
             if (match) changePercent = parseFloat(match[1]);
          }
          return {
            name: symbol === '^NSEI' ? 'Nifty 50' : symbol === '^BSESN' ? 'Sensex' : 'Bank Nifty',
            price,
            change: 0,
            changePercent,
            dayHigh: price,
            dayLow: price,
            volume: 0,
          };
        }
      }
    } catch (gErr) {
      // Ignored
    }

    // console.error(`[Yahoo] Failed to fetch index ${symbol}:`, error.message);
    return null;
  }
}

// ============================================================
// Batch Fetch — price and fundamentals run concurrently
// ============================================================

/**
 * Fetch price data for all stocks in rate-limited batches.
 * Angel One: 2 concurrent, 300ms delay (no rate limit risk).
 * Yahoo Finance: 2 concurrent, 3.5s delay (avoids 429s on Render).
 */
async function batchFetchPrices(stocks, days) {
  const concurrency = 2;
  const delay = USE_ANGELONE ? 300 : 3500;
  const priceMap = new Map(); // symbol → priceData

  for (let i = 0; i < stocks.length; i += concurrency) {
    const batch = stocks.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(s => fetchStockData(s.symbol, days))
    );
    settled.forEach((r, j) => {
      if (r.status === 'fulfilled' && r.value) {
        priceMap.set(batch[j].symbol, r.value);
      }
    });
    if (i + concurrency < stocks.length) {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return priceMap;
}

/**
 * Fetch fundamentals for all stocks with higher concurrency.
 * Screener.in tolerates more parallel requests than Yahoo Finance.
 */
async function batchFetchFundamentals(stocks) {
  const concurrency = 8; // Screener.in handles parallelism better
  const fundMap = new Map(); // symbol → fundData

  for (let i = 0; i < stocks.length; i += concurrency) {
    const batch = stocks.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(s => fetchFundamentals(s.symbol))
    );
    settled.forEach((r, j) => {
      if (r.status === 'fulfilled' && r.value) {
        fundMap.set(batch[j].symbol, r.value);
      }
    });
    if (i + concurrency < stocks.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return fundMap;
}

/**
 * Main batch fetch — runs price and fundamentals pipelines concurrently.
 * Total scan time = max(price_time, fund_time) instead of their sum.
 * With Angel One: ~15-20s. With Yahoo: still slow but fundamentals don't add extra.
 */
export async function batchFetchStocks(stocks, days = 90) {
  // Run both pipelines in parallel
  const [priceMap, fundMap] = await Promise.all([
    batchFetchPrices(stocks, days),
    batchFetchFundamentals(stocks),
  ]);

  const results = [];
  for (const s of stocks) {
    const priceData = priceMap.get(s.symbol);
    if (!priceData) continue;
    results.push({
      ...priceData,
      name: s.name,
      sector: s.sector,
      fundamentals: fundMap.get(s.symbol) || null,
    });
  }

  console.log(`  💡 Price data: ${priceMap.size}/${stocks.length} | Fundamentals: ${fundMap.size}/${stocks.length}`);
  return results;
}

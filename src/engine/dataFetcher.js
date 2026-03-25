import yahooFinance from 'yahoo-finance2';
import { fetchFundamentals } from './fundamentalAnalysis.js';

/**
 * Fetches historical OHLCV data for an NSE stock from Yahoo Finance.
 * @param {string} symbol - NSE stock symbol (without .NS suffix)
 * @param {number} days - Number of days of history to fetch
 * @returns {Promise<Object>} - { quotes, currentPrice, volume, meta }
 */
export async function fetchStockData(symbol, days = 90) {
  const yahooSymbol = `${symbol}.NS`;
  const period1 = new Date();
  period1.setDate(period1.getDate() - days);

  try {
    // Fetch historical candles (for technical analysis) + real-time quote (for current price)
    const [result, quote] = await Promise.all([
      yahooFinance.historical(yahooSymbol, {
        period1: period1.toISOString().split('T')[0],
        interval: '1d',
      }),
      yahooFinance.quote(yahooSymbol).catch(() => null),
    ]);

    if (!result || result.length === 0) {
      return null;
    }

    const quotes = result.map(q => ({
      date: q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
    }));

    // Use real-time quote for accurate current price (last traded price)
    // Fallback to last historical candle if quote unavailable
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
    console.error(`Failed to fetch data for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Fetches quote summary for market overview (Nifty 50, etc.)
 */
export async function fetchMarketIndex(symbol = '^NSEI') {
  try {
    const quote = await yahooFinance.quote(symbol);
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
    console.error(`Failed to fetch index ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Batch fetch stock data + fundamentals for multiple symbols with concurrency control
 */
export async function batchFetchStocks(stocks, days = 90, concurrency = 5) {
  const results = [];
  for (let i = 0; i < stocks.length; i += concurrency) {
    const batch = stocks.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (s) => {
        const [priceData, fundData] = await Promise.allSettled([
          fetchStockData(s.symbol, days),
          fetchFundamentals(s.symbol),
        ]);
        const price = priceData.status === 'fulfilled' ? priceData.value : null;
        const fund = fundData.status === 'fulfilled' ? fundData.value : null;
        if (!price) return null;
        return { ...price, fundamentals: fund };
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
    // Small delay between batches to avoid rate limiting
    if (i + concurrency < stocks.length) {
      await new Promise(r => setTimeout(r, 800));
    }
  }
  return results;
}


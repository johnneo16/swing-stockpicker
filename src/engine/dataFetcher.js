import yahooFinance from 'yahoo-finance2';

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
    const result = await yahooFinance.historical(yahooSymbol, {
      period1: period1.toISOString().split('T')[0],
      interval: '1d',
    });

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

    const latest = quotes[quotes.length - 1];

    return {
      symbol,
      yahooSymbol,
      quotes,
      currentPrice: latest.close,
      currentVolume: latest.volume,
      previousClose: quotes.length > 1 ? quotes[quotes.length - 2].close : latest.close,
      dayChange: quotes.length > 1
        ? ((latest.close - quotes[quotes.length - 2].close) / quotes[quotes.length - 2].close) * 100
        : 0,
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
 * Batch fetch stock data for multiple symbols with concurrency control
 */
export async function batchFetchStocks(stocks, days = 90, concurrency = 5) {
  const results = [];
  for (let i = 0; i < stocks.length; i += concurrency) {
    const batch = stocks.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(s => fetchStockData(s.symbol, days))
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
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return results;
}

/**
 * Historical OHLCV loader with disk cache.
 *
 * Strategy:
 *  - Each stock gets a JSON file: data/historical/{SYMBOL}.json
 *  - File contains { symbol, lastFetched, range: {start,end}, candles: [...] }
 *  - On request, returns cached data if it covers the requested range AND
 *    was fetched today (lastFetched matches). Otherwise re-fetches.
 *  - Re-fetch is incremental when possible — only the new tail.
 *
 * Data source priority:
 *  1. Yahoo Finance (free, 10+ yrs of history, no auth)
 *  2. Future: Angel One (only ~2-3 yrs daily; we'll plug it in later)
 */

import yahooFinance from 'yahoo-finance2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchAngelOneCandles,
  hasAngelOneToken,
  isAngelOneConfigured,
} from '../engine/angelOneProvider.js';

const USE_ANGELONE = isAngelOneConfigured();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR    = path.join(PROJECT_ROOT, 'data', 'historical');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Yahoo's `historical` is being deprecated; use `chart` for forward compat.
yahooFinance.suppressNotices?.(['yahooSurvey', 'ripHistorical']);

const yahooSymbol = (sym) => sym.startsWith('^') ? sym : `${sym}.NS`;
const cachePath  = (sym) => path.join(CACHE_DIR, `${sym}.json`);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Load cached data for a symbol, if any.
 */
function readCache(symbol) {
  const p = cachePath(symbol);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Re-hydrate Date objects
    raw.candles = raw.candles.map(c => ({ ...c, date: new Date(c.date) }));
    return raw;
  } catch (e) {
    console.warn(`[historicalLoader] Cache for ${symbol} corrupt, ignoring:`, e.message);
    return null;
  }
}

function writeCache(symbol, data) {
  const p = cachePath(symbol);
  fs.writeFileSync(p, JSON.stringify({
    ...data,
    candles: data.candles.map(c => ({
      ...c,
      date: c.date instanceof Date ? c.date.toISOString() : c.date,
    })),
  }));
}

/**
 * Fetch OHLCV from Yahoo via the `chart` API, with retry/backoff on 429.
 */
async function fetchYahooRange(symbol, startISO, endISO, maxRetries = 3) {
  const ySym = yahooSymbol(symbol);
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await yahooFinance.chart(ySym, {
        period1: startISO,
        period2: endISO,
        interval: '1d',
      });
      if (!result?.quotes?.length) return [];

      return result.quotes
        .filter(q => q.close != null && q.open != null && q.high != null && q.low != null)
        .map(q => {
          const ratio = (q.adjclose && q.close && q.close > 0) ? q.adjclose / q.close : 1;
          return {
            date: new Date(q.date),
            open: q.open * ratio,
            high: q.high * ratio,
            low: q.low * ratio,
            close: q.adjclose || q.close,
            volume: q.volume || 0,
          };
        });
    } catch (err) {
      lastErr = err;
      const is429 = err.message?.includes('Too Many Requests') || err.message?.includes('429');
      if (attempt < maxRetries && is429) {
        const delay = 3000 * Math.pow(2, attempt); // 3s, 6s, 12s
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

/**
 * Fetch OHLCV from Angel One (preferred — no rate limits at our scale).
 * Angel One only allows ~365 days per call, so chunk if range is wider.
 */
async function fetchAngelOneRange(symbol, startISO, endISO) {
  const start = new Date(startISO);
  const end   = new Date(endISO);

  // Chunk into 1-year windows
  const chunks = [];
  let cursorStart = start;
  while (cursorStart < end) {
    const cursorEnd = new Date(Math.min(
      cursorStart.getTime() + 364 * 86400000,
      end.getTime(),
    ));
    chunks.push({ from: new Date(cursorStart), to: cursorEnd });
    cursorStart = new Date(cursorEnd.getTime() + 86400000);
  }

  const all = [];
  for (const { from, to } of chunks) {
    try {
      const candles = await fetchAngelOneCandles(symbol, from, to);
      all.push(...candles);
      // Throttle: Angel One = 3 req/s; we use 350ms to be safe
      await new Promise(r => setTimeout(r, 350));
    } catch (err) {
      console.warn(`  ⚠ AngelOne chunk ${isoDate(from)}→${isoDate(to)} for ${symbol}: ${err.message}`);
    }
  }

  // De-dupe by date (in case of overlap)
  const seen = new Set();
  return all.filter(c => {
    const key = isoDate(c.date);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.date - b.date);
}

/**
 * Provider-agnostic range fetch — tries Angel One first, falls back to Yahoo.
 */
async function fetchRange(symbol, startISO, endISO) {
  if (USE_ANGELONE && hasAngelOneToken(symbol)) {
    try {
      const data = await fetchAngelOneRange(symbol, startISO, endISO);
      if (data.length > 0) return data;
    } catch (err) {
      console.warn(`  ⚠ AngelOne failed for ${symbol}, trying Yahoo: ${err.message}`);
    }
  }
  return fetchYahooRange(symbol, startISO, endISO);
}

/**
 * Get OHLCV history for a symbol covering [startDate, endDate].
 * Uses cache if fresh; merges incrementally otherwise.
 *
 * @param {string} symbol — bare NSE symbol (e.g. "RELIANCE")
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 * @returns {Promise<Array<{date,open,high,low,close,volume}>>}
 */
export async function loadHistorical(symbol, startDate, endDate) {
  const startISO = isoDate(startDate);
  const endISO   = isoDate(endDate);
  const today    = todayISO();

  let cache = readCache(symbol);

  // Decide if we need to refetch
  const cacheCoversStart = cache && cache.range && cache.range.start <= startISO;
  const cacheCoversEnd   = cache && cache.range && cache.range.end   >= endISO;
  const cacheIsFresh     = cache && cache.lastFetched === today;

  if (cache && cacheCoversStart && cacheCoversEnd && (cacheIsFresh || endISO < today)) {
    // Cache is sufficient — slice to requested range
    return cache.candles.filter(c => {
      const d = isoDate(c.date);
      return d >= startISO && d <= endISO;
    });
  }

  // Need to fetch — either new cache or extend
  let candles;
  if (cache && cacheCoversStart && !cacheIsFresh) {
    // Incremental: fetch only the tail beyond cache.range.end
    const tailStart = cache.range.end;
    try {
      const tail = await fetchRange(symbol, tailStart, endISO);
      const existing = new Set(cache.candles.map(c => isoDate(c.date)));
      const newCandles = tail.filter(c => !existing.has(isoDate(c.date)));
      candles = [...cache.candles, ...newCandles].sort((a, b) => a.date - b.date);
    } catch (err) {
      console.warn(`[historicalLoader] Tail fetch failed for ${symbol}, using stale cache:`, err.message);
      candles = cache.candles;
    }
  } else {
    // Full fetch
    try {
      // Always fetch a wider range to keep cache useful — go back min(startISO, 4yr ago)
      const fourYearsAgo = new Date(Date.now() - 4 * 365 * 86400000).toISOString().slice(0, 10);
      const fetchStart = startISO < fourYearsAgo ? startISO : fourYearsAgo;
      candles = await fetchRange(symbol, fetchStart, endISO);
    } catch (err) {
      console.warn(`[historicalLoader] Full fetch failed for ${symbol}:`, err.message);
      return cache?.candles?.filter(c => {
        const d = isoDate(c.date);
        return d >= startISO && d <= endISO;
      }) || [];
    }
  }

  if (!candles || candles.length === 0) return [];

  const newCache = {
    symbol,
    lastFetched: today,
    range: {
      start: isoDate(candles[0].date),
      end:   isoDate(candles[candles.length - 1].date),
    },
    candles,
  };
  writeCache(symbol, newCache);

  return candles.filter(c => {
    const d = isoDate(c.date);
    return d >= startISO && d <= endISO;
  });
}

/**
 * Bulk loader — fetches multiple symbols with rate limiting.
 * Returns Map<symbol, candles[]>.
 */
export async function loadHistoricalBulk(symbols, startDate, endDate, options = {}) {
  const concurrency = options.concurrency || 3;
  const delayMs     = options.delayMs     || 1500;
  const out = new Map();

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(s => loadHistorical(s, startDate, endDate))
    );
    settled.forEach((r, j) => {
      if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
        out.set(batch[j], r.value);
      } else {
        console.warn(`  ⚠ ${batch[j]}: ${r.status === 'rejected' ? r.reason?.message : 'no data'}`);
      }
    });

    if (i + concurrency < symbols.length) {
      const done = Math.min(i + concurrency, symbols.length);
      process.stdout.write(`  [${done}/${symbols.length}] cached\r`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.log(`\n  ✅ Loaded ${out.size}/${symbols.length} symbols`);
  return out;
}

/**
 * Inspect cache status.
 */
export function cacheStatus() {
  if (!fs.existsSync(CACHE_DIR)) return { dir: CACHE_DIR, files: 0, totalMB: 0 };
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += fs.statSync(path.join(CACHE_DIR, f)).size;
  }
  return {
    dir: CACHE_DIR,
    files: files.length,
    totalMB: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
  };
}

/**
 * Clear cache (use with care — re-fetching 200 stocks takes ~10 min).
 */
export function clearCache() {
  if (!fs.existsSync(CACHE_DIR)) return;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(CACHE_DIR, f));
  }
}

/**
 * Market Regime Detector
 *
 * Daily snapshot of market state used to:
 *   1. Tag every scan with a regime label (so we can analyse setup performance per regime)
 *   2. Adjust score thresholds and position sizing per regime
 *   3. Surface a "today's market" header in the UI
 *
 * Inputs:
 *   - India VIX (level + percentile)
 *   - Nifty 50 close + 20-day trend
 *   - FII / DII net flows (cash market)
 *   - Market breadth — advances vs declines (best-effort)
 *
 * Sources: stock-nse-india (NSE direct — Yahoo 429s a lot for indices)
 */

import { NseIndia } from 'stock-nse-india';
import { marketContextRepo } from '../persistence/db.js';

const nse = new NseIndia();

// ─────────────────────────────────────────────────────────────────────────────
// FETCHERS
// ─────────────────────────────────────────────────────────────────────────────

async function fetchVixAndIndices() {
  const idx = await nse.getDataByEndpoint('/api/allIndices');
  const find = (sym) => idx?.data?.find(i => i.indexSymbol === sym || i.index === sym);

  const vix    = find('INDIA VIX');
  const nifty  = find('NIFTY 50');
  const bn     = find('NIFTY BANK');

  return {
    vix:   vix   ? { last: vix.last, change: vix.percentChange, prevClose: vix.previousClose, yearHigh: vix.yearHigh, yearLow: vix.yearLow } : null,
    nifty: nifty ? { last: nifty.last, change: nifty.percentChange, prevClose: nifty.previousClose } : null,
    bn:    bn    ? { last: bn.last, change: bn.percentChange } : null,
  };
}

async function fetchFiiDii() {
  try {
    const data = await nse.getDataByEndpoint('/api/fiidiiTradeReact');
    if (!Array.isArray(data) || data.length === 0) return null;
    const fii = data.find(r => /FII|FPI/i.test(r.category || r.clientType || ''));
    const dii = data.find(r => /DII/i.test(r.category || r.clientType || ''));
    return {
      fii: fii ? { net: parseFloat(fii.netValue) || 0, buy: parseFloat(fii.buyValue) || 0, sell: parseFloat(fii.sellValue) || 0 } : null,
      dii: dii ? { net: parseFloat(dii.netValue) || 0, buy: parseFloat(dii.buyValue) || 0, sell: parseFloat(dii.sellValue) || 0 } : null,
      date: fii?.date || dii?.date || null,
    };
  } catch (_) { return null; }
}

async function fetchBreadth() {
  // Try the simpler advance-decline first
  for (const ep of ['/api/live-analysis-advance-decline', '/api/snapshot-capital-market-accord']) {
    try {
      const data = await nse.getDataByEndpoint(ep);
      // Schemas vary across NSE endpoints — try common shapes
      const advances = data?.advances ?? data?.data?.advances ?? data?.[0]?.advances;
      const declines = data?.declines ?? data?.data?.declines ?? data?.[0]?.declines;
      if (Number.isFinite(parseFloat(advances)) && Number.isFinite(parseFloat(declines))) {
        return { advances: parseInt(advances, 10), declines: parseInt(declines, 10) };
      }
    } catch (_) { /* try next */ }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map raw inputs → regime label.
 *
 * Buckets:
 *   - high_fear_mean_revert   : VIX > 22 OR PCR > 1.4
 *   - low_vol_complacent      : VIX < 13 — cheap-vol, narrow ranges
 *   - low_vol_trending        : VIX in normal band + Nifty up >2% on the week
 *   - risk_off_drawdown       : Nifty below 50DMA equivalent (proxy: down >2% on week)
 *   - neutral                 : everything else
 */
function classifyRegime({ vix, niftyChange, niftyTrend20 }) {
  if (!vix) return { regime: 'unknown', volatility: 'unknown', trend: 'unknown' };

  const vixLevel = vix.last;
  const niftyChg = niftyChange ?? 0;
  const trend20  = niftyTrend20 ?? 0;

  // Volatility band
  let volatility;
  if (vixLevel > 22)        volatility = 'high';
  else if (vixLevel < 13)   volatility = 'low';
  else                       volatility = 'normal';

  // Trend (using day change as proxy when 20d isn't available)
  let trend;
  if (trend20 > 3 || (trend20 == 0 && niftyChg > 1))         trend = 'bullish';
  else if (trend20 < -3 || (trend20 == 0 && niftyChg < -1))  trend = 'bearish';
  else                                                         trend = 'sideways';

  // Composite regime
  let regime;
  if (volatility === 'high') regime = 'high_fear_mean_revert';
  else if (volatility === 'low' && trend === 'bullish') regime = 'low_vol_trending';
  else if (volatility === 'low') regime = 'low_vol_complacent';
  else if (trend === 'bearish') regime = 'risk_off_drawdown';
  else if (trend === 'bullish') regime = 'risk_on_uptrend';
  else regime = 'neutral';

  return { regime, volatility, trend };
}

/**
 * Strategy preferences per regime — applied on top of the engine's score.
 * Used by the orchestrator (or returned to the UI) to nudge selection.
 */
export function regimeBias(regime) {
  switch (regime) {
    case 'high_fear_mean_revert':
      return {
        prefer:    ['Mean Reversion', 'Pullback / RSI Reversal', 'Hammer at Support'],
        avoid:     ['Breakout', 'Breakout + ADX Trend', 'Bollinger Squeeze'],
        scoreNudge: -8,                       // require higher conviction in chop
        sizeMultiplier: 0.5,                  // half-size in fear regimes
      };
    case 'low_vol_complacent':
      return {
        prefer:    ['Bollinger Squeeze', 'Consolidation + Support'],
        avoid:     [],
        scoreNudge: -3,
        sizeMultiplier: 0.75,
      };
    case 'low_vol_trending':
    case 'risk_on_uptrend':
      return {
        prefer:    ['Breakout', 'Breakout + ADX Trend', 'HH/HL Trend Continuation', 'Trend Continuation'],
        avoid:     ['Mean Reversion'],
        scoreNudge: 0,
        sizeMultiplier: 1.0,
      };
    case 'risk_off_drawdown':
      return {
        prefer:    [],
        avoid:     ['Breakout', 'Trend Continuation'],
        scoreNudge: -10,
        sizeMultiplier: 0.4,
      };
    default:
      return { prefer: [], avoid: [], scoreNudge: 0, sizeMultiplier: 1.0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: refresh + read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all regime inputs, classify, persist, return the snapshot.
 */
export async function refreshRegime() {
  const [marketIdx, fiiDii, breadth] = await Promise.all([
    fetchVixAndIndices().catch(() => null),
    fetchFiiDii().catch(() => null),
    fetchBreadth().catch(() => null),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const { regime, volatility, trend } = classifyRegime({
    vix: marketIdx?.vix,
    niftyChange: marketIdx?.nifty?.change,
  });

  const snapshot = {
    date:         today,
    niftyClose:   marketIdx?.nifty?.last ?? null,
    niftyChange:  marketIdx?.nifty?.change ?? null,
    vix:          marketIdx?.vix?.last ?? null,
    vixChange:    marketIdx?.vix?.change ?? null,
    fiiNet:       fiiDii?.fii?.net ?? null,
    diiNet:       fiiDii?.dii?.net ?? null,
    advances:     breadth?.advances ?? null,
    declines:     breadth?.declines ?? null,
    pcr:          null,
    regime,
    trend,
    volatility,
    raw: { marketIdx, fiiDii, breadth },
  };

  marketContextRepo.upsert(snapshot);
  return snapshot;
}

/**
 * Read today's regime from cache. If stale (>4h) or missing, refreshes.
 */
export async function getRegime({ forceRefresh = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const cached = marketContextRepo.get(today);
  if (!forceRefresh && cached) {
    const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
    if (ageMs < 4 * 60 * 60 * 1000) {
      return { ...cached, raw: cached.raw_json ? JSON.parse(cached.raw_json) : null, fromCache: true };
    }
  }
  return refreshRegime();
}

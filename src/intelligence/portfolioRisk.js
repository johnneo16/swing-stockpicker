/**
 * Portfolio Risk — correlation matrix + 95% Value-at-Risk
 *
 * Implements two Varsity Risk-Management module concepts that the engine
 * was missing:
 *   • ch.3-5  Variance / Covariance / Correlation matrix
 *   • ch.10   Value at Risk
 *
 * Used at two points:
 *   1. Pre-trade gate inside openPosition() — refuses a new position
 *      whose 60-day return correlation with ANY existing open position
 *      exceeds CONFIG.MAX_PAIRWISE_CORRELATION (default 0.75). This is
 *      the exact defensive layer that would have prevented the 2026-05-15
 *      killswitch trip: 10 simultaneously-drawing-down correlated names.
 *   2. Health-tab telemetry — portfolio-wide 95% 1-day VaR shown so the
 *      operator can see "I could lose ₹X tomorrow with 95% confidence".
 *
 * Uses Yahoo Finance directly (free, no Angel One call). Cached in-process
 * for 15 minutes since correlation moves slowly.
 */

import yahooFinance from 'yahoo-finance2';
import { CONFIG } from '../engine/riskEngine.js';

// Silence yahoo-finance2 survey notice + future-proof against schema noise
try { yahooFinance.suppressNotices?.(['yahooSurvey']); } catch (_) {}

const CACHE_TTL_MS = 15 * 60 * 1000;
const closesCache  = new Map();   // symbol → { ts, closes: number[] }
const inflight     = new Map();   // key → Promise — dedupes concurrent fetches

const NSE_SUFFIX_OVERRIDES = {
  // Most NSE tickers are <symbol>.NS; ETFs and a few names need overrides
  // Add here as we discover them
};

function yahooSym(symbol) {
  if (NSE_SUFFIX_OVERRIDES[symbol]) return NSE_SUFFIX_OVERRIDES[symbol];
  if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return symbol;
  return `${symbol}.NS`;
}

/**
 * Fetch the trailing N daily closes for a symbol. Returns array of numbers
 * (oldest → newest), or null on failure. Cached in-process for 15 min.
 */
async function fetchCloses(symbol, days = CONFIG.VAR_LOOKBACK_DAYS) {
  const key = `${symbol}:${days}`;
  const hit = closesCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.closes;

  // Dedup concurrent calls for the same symbol (correlationMatrix + portfolioVaR
  // both want the same closes — Promise.all double-fires without this)
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const period1 = new Date(Date.now() - (days + 10) * 24 * 60 * 60 * 1000);
      const result = await yahooFinance.historical(yahooSym(symbol), {
        period1: period1.toISOString().split('T')[0],
        interval: '1d',
      });
      if (!result || result.length < 10) return null;
      const closes = result.map(q => q.adjClose ?? q.close).filter(c => c > 0);
      closesCache.set(key, { ts: Date.now(), closes });
      return closes;
    } catch (e) {
      console.warn(`[portfolioRisk] fetchCloses(${symbol}) failed: ${e.message}`);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/**
 * Daily log returns from a close series.
 */
function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      out.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  return out;
}

/**
 * Pearson correlation between two equal-length number arrays.
 */
function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += ax[i]; sumB += bx[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = ax[i] - meanA;
    const db = bx[i] - meanB;
    num  += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return 0;
  return num / Math.sqrt(denA * denB);
}

/**
 * Build a correlation matrix for an array of symbols, using log returns
 * over the configured lookback. Returns { matrix, symbols, missing }.
 *
 *   matrix[i][j] = corr(symbols[i], symbols[j])
 */
export async function correlationMatrix(symbols, lookback = CONFIG.VAR_LOOKBACK_DAYS) {
  const uniq = [...new Set(symbols)];
  const closesArr = await Promise.all(uniq.map(s => fetchCloses(s, lookback)));
  const returnsMap = new Map();
  const missing = [];

  for (let i = 0; i < uniq.length; i++) {
    if (!closesArr[i]) { missing.push(uniq[i]); continue; }
    returnsMap.set(uniq[i], logReturns(closesArr[i]));
  }

  const present = uniq.filter(s => returnsMap.has(s));
  const matrix = present.map(a => present.map(b => {
    if (a === b) return 1;
    return +correlation(returnsMap.get(a), returnsMap.get(b)).toFixed(4);
  }));

  return { symbols: present, matrix, missing };
}

/**
 * Correlation gate — used by openPosition() pre-trade guard.
 *
 * Returns { ok: true } if the proposed symbol's correlation with every
 * existing open symbol is below the threshold; otherwise returns
 * { ok: false, reason, conflicts: [{symbol, corr}] }.
 */
export async function correlationGate(proposedSymbol, openSymbols, threshold = CONFIG.MAX_PAIRWISE_CORRELATION) {
  if (!openSymbols.length) return { ok: true, conflicts: [] };

  const all = [proposedSymbol, ...openSymbols];
  const { symbols, matrix } = await correlationMatrix(all);
  const i = symbols.indexOf(proposedSymbol);
  if (i < 0) return { ok: true, conflicts: [], note: 'proposed symbol price unavailable — gate skipped' };

  const conflicts = [];
  for (let j = 0; j < symbols.length; j++) {
    if (j === i) continue;
    const c = matrix[i][j];
    if (c > threshold) conflicts.push({ symbol: symbols[j], corr: c });
  }

  if (conflicts.length) {
    return {
      ok: false,
      reason: `Correlation > ${threshold}: ${conflicts.map(c => `${c.symbol}=${c.corr}`).join(', ')}`,
      conflicts,
    };
  }
  return { ok: true, conflicts: [] };
}

/**
 * Portfolio 95% 1-day Value-at-Risk (historical method).
 *
 * @param {Array<{symbol, weight}>} positions — weight is rupee value /
 *                                                total portfolio rupee value
 * @returns { varPct: number, varRupees: number, samples: number }
 */
export async function portfolioVaR(positions, totalCapital, lookback = CONFIG.VAR_LOOKBACK_DAYS) {
  if (!positions || positions.length === 0) {
    return { varPct: 0, varRupees: 0, samples: 0 };
  }

  const symbols = positions.map(p => p.symbol);
  const closesArr = await Promise.all(symbols.map(s => fetchCloses(s, lookback)));
  const returnsArr = closesArr.map(c => c ? logReturns(c) : null);

  // Align: take the shortest series across all valid positions
  const valid = returnsArr.filter(Boolean);
  if (valid.length === 0) return { varPct: 0, varRupees: 0, samples: 0 };
  const minLen = Math.min(...valid.map(r => r.length));

  // Portfolio daily returns = Σ weight_i × return_i,t
  const portReturns = [];
  for (let t = minLen - 1; t >= 0; t--) {
    let r = 0;
    let wSum = 0;
    for (let i = 0; i < positions.length; i++) {
      const rets = returnsArr[i];
      if (!rets) continue;
      const offset = rets.length - minLen;
      r += positions[i].weight * rets[t + offset];
      wSum += positions[i].weight;
    }
    if (wSum > 0) portReturns.push(r / wSum);
  }

  // Convert log returns to arithmetic for VaR display
  const arith = portReturns.map(r => Math.exp(r) - 1);
  arith.sort((a, b) => a - b);
  // 5th percentile = 95% VaR (loss tail)
  const idx = Math.max(0, Math.floor(arith.length * 0.05));
  const var95 = -arith[idx]; // positive number = loss magnitude

  return {
    varPct:    +(var95 * 100).toFixed(2),
    varRupees: Math.round(var95 * totalCapital),
    samples:   arith.length,
  };
}

/**
 * Convenience: full portfolio risk snapshot for the Health tab.
 *
 * @param {Array<{symbol, capital}>} openTrades
 * @param {number} totalCapital
 */
export async function portfolioRiskSnapshot(openTrades, totalCapital) {
  if (!openTrades || openTrades.length === 0) {
    return {
      var95: { varPct: 0, varRupees: 0, samples: 0 },
      correlation: { matrix: [], symbols: [], maxPair: null },
      flags: [],
    };
  }

  const deployed = openTrades.reduce((s, t) => s + (t.capital || 0), 0) || totalCapital;
  const positions = openTrades.map(t => ({
    symbol: t.symbol,
    weight: (t.capital || 0) / deployed,
  }));

  const [var95, corrResult] = await Promise.all([
    portfolioVaR(positions, totalCapital),
    correlationMatrix(positions.map(p => p.symbol)),
  ]);

  // Find max off-diagonal pair
  let maxPair = null;
  for (let i = 0; i < corrResult.symbols.length; i++) {
    for (let j = i + 1; j < corrResult.symbols.length; j++) {
      const c = corrResult.matrix[i][j];
      if (!maxPair || c > maxPair.corr) {
        maxPair = { a: corrResult.symbols[i], b: corrResult.symbols[j], corr: c };
      }
    }
  }

  const flags = [];
  if (var95.varPct > CONFIG.MAX_PORTFOLIO_VAR_PCT) {
    flags.push(`95% 1-day VaR ${var95.varPct}% exceeds threshold ${CONFIG.MAX_PORTFOLIO_VAR_PCT}%`);
  }
  if (maxPair && maxPair.corr > CONFIG.MAX_PAIRWISE_CORRELATION) {
    flags.push(`${maxPair.a}↔${maxPair.b} correlation ${maxPair.corr} exceeds ${CONFIG.MAX_PAIRWISE_CORRELATION}`);
  }

  return { var95, correlation: { ...corrResult, maxPair }, flags };
}

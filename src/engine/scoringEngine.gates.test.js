import { describe, it, expect } from 'vitest';
import { rankAndFilterTrades } from './scoringEngine.js';

/**
 * Build a synthetic scored-stock object — the shape that scoreStock returns
 * and rankAndFilterTrades consumes. Only the fields the ranker / gates /
 * validateTrade actually read need values.
 */
function trade(opts = {}) {
  return {
    symbol:          'TEST',
    sector:          'IT',
    confidenceScore: 70,
    riskRewardRatio: 2.0,
    capitalRequired: 5000,
    setupType:       'Trend Continuation',
    indicators:      { adx: 30, mtf: { weeklyTrend: 'up', weeklySlopePct: 0.5 } },
    ...opts,
  };
}

describe('rankAndFilterTrades — Pass-1 score floor (65)', () => {
  it('admits scores >= 65 in Pass 1', () => {
    const r = rankAndFilterTrades([trade({ symbol: 'A', confidenceScore: 65 })], 50000);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].symbol).toBe('A');
    expect(r.trades[0].lowConfidence).toBe(false);
  });

  it('refuses scores < 65 in Pass 1 but backfills via Pass 2 with lowConfidence=true (when ≥60 floor)', () => {
    const r = rankAndFilterTrades([trade({ symbol: 'X', confidenceScore: 60 })], 50000);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].lowConfidence).toBe(true);
  });

  it('sorts by confidence descending', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'LO', confidenceScore: 66 }),
      trade({ symbol: 'HI', confidenceScore: 88, sector: 'Banking' }),
      trade({ symbol: 'MD', confidenceScore: 75, sector: 'Pharma' }),
    ], 50000);
    expect(r.trades.map(t => t.symbol)).toEqual(['HI', 'MD', 'LO']);
  });
});

describe('rankAndFilterTrades — R:R floor 1.5', () => {
  it('refuses trades with R:R below 1.5 in BOTH passes (validateTrade enforces 1.5)', () => {
    // Pass 2 relaxes the score floor but NOT the R:R floor — validateTrade
    // re-enforces MIN_RISK_REWARD=1.5 in both passes. R:R 1.4 is dead.
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', confidenceScore: 70, riskRewardRatio: 1.4 }),
    ], 50000);
    expect(r.trades).toHaveLength(0);
  });

  it('refuses trades with R:R < 1.0 too (rejected by Pass-2 cheap-skip)', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', confidenceScore: 90, riskRewardRatio: 0.8 }),
    ], 50000);
    expect(r.trades).toHaveLength(0);
  });

  it('admits trades with R:R exactly 1.5 (boundary)', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', confidenceScore: 70, riskRewardRatio: 1.5 }),
    ], 50000);
    expect(r.trades).toHaveLength(1);
  });
});

describe('rankAndFilterTrades — ADX gate (Varsity ch.20)', () => {
  it('refuses trending setups when ADX < 25', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', setupType: 'MACD Crossover', indicators: { adx: 20, mtf: null } }),
    ], 50000);
    // ADX block in Pass 1 → flows to Pass 2 → admitted with lowConfidence=true
    // (Pass 2 bypasses ADX gate by design — fills slots when Pass 1 is thin)
    expect(r.trades[0].lowConfidence).toBe(true);
    expect(r.trades[0].blockedReason).toMatch(/ADX 20 < 25/);
  });

  it('admits trending setups when ADX >= 25 (Varsity threshold)', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', setupType: 'MACD Crossover', indicators: { adx: 25, mtf: null } }),
    ], 50000);
    expect(r.trades[0].lowConfidence).toBe(false);
    expect(r.trades[0].blockedReason).toBeUndefined();
  });

  it('refuses mean-reversion setups when ADX > 30 (no chop, runaway trend)', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', setupType: 'Mean Reversion', indicators: { adx: 35, mtf: null } }),
    ], 50000);
    expect(r.trades[0].blockedReason).toMatch(/ADX 35 > 30/);
  });

  it('admits mean-reversion when ADX <= 30', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', setupType: 'Mean Reversion', indicators: { adx: 28, mtf: null } }),
    ], 50000);
    expect(r.trades[0].lowConfidence).toBe(false);
  });

  it('passes through when ADX is not provided (no data → no gate)', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', setupType: 'MACD Crossover', indicators: { mtf: null } }),
    ], 50000);
    expect(r.trades[0].lowConfidence).toBe(false);
  });
});

describe('rankAndFilterTrades — MTF gate (Varsity Finale ch.19 + Dow)', () => {
  it('refuses trending longs when weekly trend is DOWN', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', setupType: 'MACD Crossover',
              indicators: { adx: 30, mtf: { weeklyTrend: 'down', weeklySlopePct: -0.8 } } }),
    ], 50000);
    expect(r.trades[0].blockedReason).toMatch(/Weekly trend is DOWN/);
  });

  it('admits trending longs when weekly trend is UP', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', setupType: 'MACD Crossover',
              indicators: { adx: 30, mtf: { weeklyTrend: 'up', weeklySlopePct: 1.2 } } }),
    ], 50000);
    expect(r.trades[0].lowConfidence).toBe(false);
  });

  it('mean-reversion setups are exempt from the MTF gate (they fade by design)', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', setupType: 'Mean Reversion',
              indicators: { adx: 20, mtf: { weeklyTrend: 'down', weeklySlopePct: -1.0 } } }),
    ], 50000);
    expect(r.trades[0].lowConfidence).toBe(false);
  });

  it('passes through when weeklyTrend is unknown (no signal → no gate)', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'A', setupType: 'MACD Crossover',
              indicators: { adx: 30, mtf: { weeklyTrend: 'unknown' } } }),
    ], 50000);
    expect(r.trades[0].lowConfidence).toBe(false);
  });
});

describe('rankAndFilterTrades — DISABLED_SETUPS (May 2026 loss-control)', () => {
  it('blocks Three White Soldiers from Pass-1 AND Pass-2', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'TWS', confidenceScore: 90, setupType: 'Three White Soldiers' }),
    ], 50000);
    expect(r.trades).toHaveLength(0);
  });
  it('blocks Breakout (raw)', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'BO', confidenceScore: 90, setupType: 'Breakout' }),
    ], 50000);
    expect(r.trades).toHaveLength(0);
  });
  it('blocks Breakout + ADX Trend', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'BOA', confidenceScore: 90, setupType: 'Breakout + ADX Trend' }),
    ], 50000);
    expect(r.trades).toHaveLength(0);
  });
  it('lets non-disabled trending setups through', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'OK', confidenceScore: 75, setupType: 'HH/HL Trend Continuation' }),
    ], 50000);
    expect(r.trades).toHaveLength(1);
  });
});

describe('rankAndFilterTrades — Pass-2 confidence floor (60)', () => {
  it('blocks Pass-2 fillers below confidence 60', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'LOW', confidenceScore: 55, setupType: 'HH/HL Trend Continuation' }),
    ], 50000);
    expect(r.trades).toHaveLength(0);
  });
  it('admits Pass-2 fillers at exactly 60 (boundary)', () => {
    const r = rankAndFilterTrades([
      trade({ symbol: 'EDGE', confidenceScore: 60, setupType: 'HH/HL Trend Continuation' }),
    ], 50000);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].lowConfidence).toBe(true);
  });
});

describe('rankAndFilterTrades — excludeSymbols', () => {
  it('removes excluded symbols entirely from consideration', () => {
    const r = rankAndFilterTrades(
      [trade({ symbol: 'KEEP' }), trade({ symbol: 'SKIP', sector: 'Pharma' })],
      50000,
      { excludeSymbols: new Set(['SKIP']) },
    );
    expect(r.trades.map(t => t.symbol)).toEqual(['KEEP']);
  });
});

describe('rankAndFilterTrades — maxResults', () => {
  it('caps the result list at maxResults', () => {
    const stocks = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((s, i) =>
      trade({ symbol: s, confidenceScore: 70 + i, sector: `S${i}` }),
    );
    const r = rankAndFilterTrades(stocks, 50000, { maxResults: 3 });
    expect(r.trades).toHaveLength(3);
  });
});

import { describe, it, expect } from 'vitest';
import {
  calculatePositionSize,
  validateTrade,
  volAdjustedRiskMultiplier,
  calculatePortfolioSummary,
  getCapitalForClass,
  CONFIG,
} from './riskEngine.js';

describe('volAdjustedRiskMultiplier', () => {
  it('returns 1.0 when ATR or entry price is missing', () => {
    expect(volAdjustedRiskMultiplier(100, 0)).toBe(1.0);
    expect(volAdjustedRiskMultiplier(100, null)).toBe(1.0);
    expect(volAdjustedRiskMultiplier(0, 5)).toBe(1.0);
  });

  it('cuts size on very volatile stocks (ATR/price >= 5%)', () => {
    expect(volAdjustedRiskMultiplier(100, 6)).toBeCloseTo(0.60, 2);
  });

  it('boosts size on very low-vol stocks (ATR/price < 1%)', () => {
    expect(volAdjustedRiskMultiplier(100, 0.5)).toBeCloseTo(1.20, 2);
  });

  it('applies confidence nudge over the vol mult', () => {
    const base = volAdjustedRiskMultiplier(100, 2);        // moderate-high vol → 0.90
    const high = volAdjustedRiskMultiplier(100, 2, 80);    // +10% nudge
    const low  = volAdjustedRiskMultiplier(100, 2, 40);    // -8% nudge
    expect(high).toBeGreaterThan(base);
    expect(low).toBeLessThan(base);
  });

  it('clamps to [0.60, 1.30] regardless of inputs', () => {
    expect(volAdjustedRiskMultiplier(100, 10, 95)).toBeLessThanOrEqual(1.30);
    expect(volAdjustedRiskMultiplier(100, 10, 10)).toBeGreaterThanOrEqual(0.60);
  });
});

describe('calculatePositionSize', () => {
  it('returns null when riskPerShare is 0 (stop == entry)', () => {
    expect(calculatePositionSize(100, 100)).toBeNull();
  });

  it('uses the smaller of risk-based vs 20%-capital cap', () => {
    // entry 100, stop 99 → risk/share 1. risk amount = 50000 * 0.015 = 750
    // → riskQuantity = 750; 20% cap = 10000 / 100 = 100. → expect 100.
    const pos = calculatePositionSize(100, 99, 0.015, 50000);
    expect(pos.quantity).toBe(100);
    expect(pos.capitalRequired).toBe(10000);
  });

  it('applies ATR-aware sizing when opts.atr is provided', () => {
    const noAtr = calculatePositionSize(100, 90, 0.015, 50000);
    const highVol = calculatePositionSize(100, 90, 0.015, 50000, { atr: 6 });   // 6% ATR → mult 0.60
    expect(highVol.quantity).toBeLessThan(noAtr.quantity);
    expect(highVol.volMultiplier).toBeCloseTo(0.60, 2);
  });

  it('clamps adjusted risk percent at MAX_RISK_PERCENT (2%)', () => {
    const pos = calculatePositionSize(100, 99, 0.018, 50000, { atr: 0.5, confidenceScore: 90 });
    expect(pos.riskPercentApplied).toBeLessThanOrEqual(CONFIG.MAX_RISK_PERCENT * 100);
  });
});

describe('validateTrade', () => {
  const base = { riskRewardRatio: 2.0, capitalRequired: 5000, sector: 'IT' };

  it('rejects R:R below 1.5', () => {
    const r = validateTrade({ ...base, riskRewardRatio: 1.4 });
    expect(r.valid).toBe(false);
    expect(r.issues.some(m => m.includes('Risk-reward'))).toBe(true);
  });

  it('rejects when concurrent trades >= MAX_CONCURRENT_TRADES (5)', () => {
    const existing = Array(5).fill({ capitalRequired: 1000, sector: 'XX' });
    const r = validateTrade(base, existing);
    expect(r.valid).toBe(false);
    expect(r.issues.some(m => m.includes('concurrent'))).toBe(true);
  });

  it('rejects 4th trade in the same sector', () => {
    const existing = Array(3).fill({ capitalRequired: 1000, sector: 'IT' });
    const r = validateTrade(base, existing);
    expect(r.valid).toBe(false);
    expect(r.issues.some(m => m.includes('Sector IT'))).toBe(true);
  });

  it('allows up to 3 trades per sector', () => {
    const existing = Array(2).fill({ capitalRequired: 1000, sector: 'IT' });
    const r = validateTrade(base, existing);
    expect(r.valid).toBe(true);
  });

  it('rejects when capital required exceeds available', () => {
    const existing = [{ capitalRequired: 48000, sector: 'XX' }];
    const r = validateTrade({ ...base, capitalRequired: 5000 }, existing);
    expect(r.valid).toBe(false);
    expect(r.issues.some(m => m.includes('Insufficient capital'))).toBe(true);
  });

  it('warns but does not reject when cash-reserve threshold breached', () => {
    // total 50000, reserve 15% = 7500. Deployed 40000 → available 10000, maxDeployable 2500.
    // Trade for 5000 fits available but breaches reserve.
    const existing = [{ capitalRequired: 40000, sector: 'XX' }];
    const r = validateTrade({ ...base, capitalRequired: 5000 }, existing);
    expect(r.valid).toBe(true);
    expect(r.warnings.some(m => m.includes('cash reserve'))).toBe(true);
  });
});

describe('getCapitalForClass', () => {
  it('returns the right pool per asset class', () => {
    expect(getCapitalForClass('stock')).toBe(CONFIG.TOTAL_CAPITAL);
    expect(getCapitalForClass('etf')).toBe(CONFIG.TOTAL_CAPITAL_ETF);
    expect(getCapitalForClass('commodity')).toBe(CONFIG.TOTAL_CAPITAL_COMMODITY);
    expect(getCapitalForClass()).toBe(CONFIG.TOTAL_CAPITAL);     // default
    expect(getCapitalForClass('unknown')).toBe(CONFIG.TOTAL_CAPITAL); // fallback
  });
});

describe('calculatePortfolioSummary', () => {
  it('aggregates deployed capital, risk, sectors across active trades', () => {
    const trades = [
      { capitalRequired: 5000, riskAmount: 100, sector: 'IT' },
      { capitalRequired: 3000, riskAmount: 50,  sector: 'IT' },
      { capitalRequired: 2000, riskAmount: 40,  sector: 'Banking' },
    ];
    const s = calculatePortfolioSummary(trades, 50000);
    expect(s.capitalDeployed).toBe(10000);
    expect(s.totalRiskExposure).toBe(190);
    expect(s.activeTradeCount).toBe(3);
    expect(s.sectorDistribution).toEqual({ IT: 2, Banking: 1 });
    expect(s.remainingCash).toBe(40000);
  });

  it('handles empty active-trade list', () => {
    const s = calculatePortfolioSummary([], 50000);
    expect(s.capitalDeployed).toBe(0);
    expect(s.activeTradeCount).toBe(0);
    expect(s.sectorDistribution).toEqual({});
  });
});

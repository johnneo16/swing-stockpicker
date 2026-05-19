/**
 * Tests for the simulator cost model (M5.5).
 *
 * Focus is the cost ledger: brokerage / STT / stamp duty + slippage.
 * Trigger-detection rules (stop/target/time/gap-down) have been validated
 * empirically via the Run #17 backtest and aren't re-tested here.
 */
import { describe, it, expect } from 'vitest';
import { simulateTrade } from './simulator.js';

// Standard 25-day uptrend that hits target on day 5 — gives us a clean
// frame to assert the cost breakdown without random noise.
function makeCandles(prices, startDate = '2024-01-02') {
  const base = new Date(startDate).getTime();
  return prices.map((p, i) => ({
    date:   new Date(base + i * 86400000).toISOString().slice(0, 10),
    open:   p, high: p * 1.01, low: p * 0.99, close: p,
    volume: 100000,
  }));
}

function basicTrade() {
  return {
    symbol:      'TEST',
    entryDate:   '2024-01-02',
    entryPrice:  100,
    stopLoss:     95,
    targetPrice: 110,
    quantity:    100,
  };
}

describe('simulator cost model', () => {
  it('applies brokerage, STT, and stamp duty in addition to slippage', () => {
    const trade = basicTrade();
    // Target = 110, day 1 closes at 100, day 2 hits target via high.
    // Make day 2 open below target but high above target so target_hit fires.
    const candles = [
      { date: '2024-01-03', open: 102, high: 105, low: 101, close: 104, volume: 1 },
      { date: '2024-01-04', open: 108, high: 112, low: 108, close: 111, volume: 1 },
    ];
    const r = simulateTrade(trade, candles);

    // Sanity: target_hit
    expect(r.exitReason).toBe('target');
    // Cost breakdown is present and positive
    expect(r.costBreakdown).toBeDefined();
    expect(r.costBreakdown.brokerage).toBeGreaterThan(0);
    expect(r.costBreakdown.stt).toBeGreaterThan(0);
    expect(r.costBreakdown.stamp).toBeGreaterThan(0);
    expect(r.costBreakdown.total).toBe(
      r.costBreakdown.brokerage + r.costBreakdown.stt + r.costBreakdown.stamp,
    );
  });

  it('STT is computed on sell notional only (not symmetric)', () => {
    const trade = basicTrade();
    const candles = [
      { date: '2024-01-03', open: 108, high: 112, low: 108, close: 111, volume: 1 },
    ];
    const noStt   = simulateTrade(trade, candles, { sttBps: 0 });
    const withStt = simulateTrade(trade, candles, { sttBps: 10 });   // 0.10%

    // STT delta = sellNotional × 0.001
    // sellNotional = exitPrice × qty. Exit at 110 × (1 - 0.002) = 109.78
    // × qty=100 → 10,978 × 0.001 = ~10.98
    const delta = withStt.costBreakdown.total - noStt.costBreakdown.total;
    expect(delta).toBeGreaterThan(10);
    expect(delta).toBeLessThan(11.5);
    expect(noStt.costBreakdown.stt).toBe(0);
  });

  it('stamp duty is computed on buy notional only', () => {
    const trade = basicTrade();
    const candles = [
      { date: '2024-01-03', open: 108, high: 112, low: 108, close: 111, volume: 1 },
    ];
    const noStamp   = simulateTrade(trade, candles, { stampBps: 0 });
    const withStamp = simulateTrade(trade, candles, { stampBps: 1.5 }); // 0.015%

    // stamp = 100 × 100 × 0.00015 = 1.5
    const delta = withStamp.costBreakdown.total - noStamp.costBreakdown.total;
    expect(delta).toBeCloseTo(1.5, 1);
    expect(noStamp.costBreakdown.stamp).toBe(0);
  });

  it('reports both pnlPct (gross) and pnlPctNet (net of costs)', () => {
    const trade = basicTrade();
    const candles = [
      { date: '2024-01-03', open: 108, high: 112, low: 108, close: 111, volume: 1 },
    ];
    const r = simulateTrade(trade, candles);
    // Gross pnlPct = (exitPrice − entryPrice) / entryPrice × 100
    //  exitPrice  = 110 × (1 − 0.002) = 109.78
    //  gross pct  = 9.78%
    expect(r.pnlPct).toBeCloseTo(9.78, 1);
    // Net pct is strictly less than gross by the cost-percentage
    expect(r.pnlPctNet).toBeLessThan(r.pnlPct);
    // Cost percentage ≈ totalCost / buyNotional × 100
    const expectedDelta = (r.costBreakdown.total / (trade.entryPrice * trade.quantity)) * 100;
    expect(r.pnlPct - r.pnlPctNet).toBeCloseTo(expectedDelta, 1);
  });

  it('zero-cost mode (all bps=0) yields identical gross and net pct', () => {
    const trade = basicTrade();
    const candles = [
      { date: '2024-01-03', open: 108, high: 112, low: 108, close: 111, volume: 1 },
    ];
    const r = simulateTrade(trade, candles, {
      slippageBps: 0, brokerageBps: 0, sttBps: 0, stampBps: 0,
    });
    expect(r.pnlPct).toBe(r.pnlPctNet);
    expect(r.costBreakdown.total).toBe(0);
    // Without slippage, exit is exactly target price
    expect(r.exitPrice).toBe(110);
  });

  it('handles stop_gap (gap-down through stop) with cost ledger', () => {
    const trade = basicTrade();
    const candles = [
      { date: '2024-01-03', open: 90, high: 92, low: 88, close: 89, volume: 1 },
    ];
    const r = simulateTrade(trade, candles);
    expect(r.exitReason).toBe('stop_gap');
    expect(r.pnl).toBeLessThan(0);             // loss
    expect(r.costBreakdown.total).toBeGreaterThan(0);
  });
});

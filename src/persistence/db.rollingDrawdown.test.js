/**
 * Tests for tradesRepo.rollingDrawdownPct — the fix for the killswitch
 * recurring-trip bug.
 *
 * Pre-fix behavior: jobRiskKillswitch read journalStats.maxDrawdownPct
 * (all-time, monotonically non-decreasing) and tripped daily forever
 * once any 8%+ DD had occurred.
 *
 * Post-fix behavior: rollingDrawdownPct computes DD over a rolling
 * `windowDays` window, so old drawdown sequences age out of the
 * killswitch signal naturally.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { tradesRepo, db } from './db.js';

const HOUR_MS = 3600 * 1000;
const DAY_MS  = 24 * HOUR_MS;

/**
 * Insert a closed paper trade with explicit exit_date and realized_pnl.
 * The schema requires several non-null fields; we fill the minimum set.
 */
function insertClosed({ exitDaysAgo, pnl, capital = 50000, symbol = 'TEST' }) {
  const exitDate = new Date(Date.now() - exitDaysAgo * DAY_MS).toISOString();
  const entryDate = new Date(Date.now() - (exitDaysAgo + 5) * DAY_MS).toISOString();
  db.prepare(`
    INSERT INTO trades (symbol, sector, setup_type, entry_date, entry_price,
                        initial_stop, current_stop, target_price,
                        quantity, risk_amount, capital,
                        status, mode, confidence,
                        exit_date, exit_price, exit_reason,
                        realized_pnl, realized_pct,
                        holding_days, asset_class)
    VALUES (?, 'IT', 'Breakout', ?, 100,
            95, 95, 110,
            10, 50, ?,
            'closed', 'paper', 70,
            ?, ?, 'target',
            ?, ?,
            5, 'stock')
  `).run(symbol, entryDate, capital,
         exitDate, 100 + pnl / 10, pnl, (pnl / 10) / 100 * 100);
}

beforeEach(() => {
  db.exec("DELETE FROM trades WHERE mode = 'paper'");
});

describe('tradesRepo.rollingDrawdownPct', () => {
  it('returns 0 when no closed trades fall in the window', () => {
    const r = tradesRepo.rollingDrawdownPct('paper', 90);
    expect(r).toEqual({ maxDrawdownPct: 0, tradesInWindow: 0, windowDays: 90 });
  });

  it('ignores trades older than windowDays — THE killswitch fix', () => {
    // 200 days ago: catastrophic 30% drawdown loss
    insertClosed({ exitDaysAgo: 200, pnl: -15000, symbol: 'ANCIENT' });

    // Last 30 days: small wins only, no DD
    insertClosed({ exitDaysAgo: 25, pnl: +500, symbol: 'A' });
    insertClosed({ exitDaysAgo: 10, pnl: +800, symbol: 'B' });

    const r = tradesRepo.rollingDrawdownPct('paper', 90);
    // The 200-day-old blowup is OUT of the 90-day window → DD = 0%
    expect(r.maxDrawdownPct).toBe(0);
    expect(r.tradesInWindow).toBe(2);
  });

  it('reconstructs equity curve and reports max peak-to-trough DD inside the window', () => {
    // Day -60: +5000 (peak after this trade)
    // Day -40: -3000 (trough)
    // Day -10: -2000 (still below peak, but smaller next dip)
    insertClosed({ exitDaysAgo: 60, pnl: +5000, symbol: 'WIN1' });
    insertClosed({ exitDaysAgo: 40, pnl: -3000, symbol: 'LOSS1' });
    insertClosed({ exitDaysAgo: 10, pnl: -2000, symbol: 'LOSS2' });

    const r = tradesRepo.rollingDrawdownPct('paper', 90);
    // Starting capital 50000. After WIN1: equity 55000 (peak).
    // After LOSS1: 52000. DD from 55000 → 52000 = 5.45%.
    // After LOSS2: 50000. DD from 55000 → 50000 = 9.09%.
    // Max DD in window = 9.09%
    expect(r.maxDrawdownPct).toBeCloseTo(9.09, 1);
    expect(r.tradesInWindow).toBe(3);
  });

  it('respects the window boundary precisely', () => {
    // Just outside window — should be ignored
    insertClosed({ exitDaysAgo: 95, pnl: -5000 });
    // Just inside — should count
    insertClosed({ exitDaysAgo: 85, pnl: -1000 });

    const r = tradesRepo.rollingDrawdownPct('paper', 90);
    expect(r.tradesInWindow).toBe(1);
    // Single loss of 1000 from 50k start: equity 50k → 49k.
    // Peak was 50k, trough 49k → DD 2%
    expect(r.maxDrawdownPct).toBeCloseTo(2.0, 1);
  });

  it('supports custom window sizes', () => {
    insertClosed({ exitDaysAgo: 40, pnl: -3000 });
    insertClosed({ exitDaysAgo: 20, pnl: -1000 });

    const r30  = tradesRepo.rollingDrawdownPct('paper', 30);
    const r90  = tradesRepo.rollingDrawdownPct('paper', 90);
    expect(r30.tradesInWindow).toBe(1);
    expect(r90.tradesInWindow).toBe(2);
    // 30-day: only the -1000 loss. DD 2%
    expect(r30.maxDrawdownPct).toBeCloseTo(2.0, 1);
    // 90-day: -3000 then -1000. DD 8%
    expect(r90.maxDrawdownPct).toBeCloseTo(8.0, 1);
  });
});

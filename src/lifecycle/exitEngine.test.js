import { describe, it, expect } from 'vitest';
import { evaluateExit } from './exitEngine.js';

/**
 * Synthetic position factory — minimum fields evaluateExit reads.
 * Override any field via opts.
 */
function pos(opts = {}) {
  return {
    id: 1,
    symbol: 'TEST',
    entryPrice:   100,
    initialStop:   95,
    currentStop:   95,
    target:       115,
    quantity:      10,
    lastPrice:   105,
    heldDays:      3,
    beMoved:    false,
    partialTaken: false,
    rMultiple:    1.0,
    ...opts,
  };
}

describe('evaluateExit', () => {
  it('returns hold:incomplete_state when required fields are missing', () => {
    expect(evaluateExit({ ...pos(), lastPrice: null }).type).toBe('hold');
    expect(evaluateExit({ ...pos(), currentStop: null }).type).toBe('hold');
    expect(evaluateExit({ ...pos(), target: null }).type).toBe('hold');
  });

  it('returns close:stop_hit when lastPrice <= currentStop', () => {
    const a = evaluateExit(pos({ lastPrice: 95 }));
    expect(a).toMatchObject({ type: 'close', reason: 'stop_hit', exitPrice: 95, tradeId: 1 });
  });

  it('returns close:target_hit when lastPrice >= target', () => {
    const a = evaluateExit(pos({ lastPrice: 115 }));
    expect(a).toMatchObject({ type: 'close', reason: 'target_hit', exitPrice: 115 });
  });

  it('stop_hit beats target_hit when both are technically true', () => {
    // Pathological/impossible state, but the priority order must be deterministic.
    const a = evaluateExit(pos({ lastPrice: 95, currentStop: 96, target: 80 }));
    expect(a.reason).toBe('stop_hit');
  });

  it('returns close:time_stop after maxHoldingDays (default 25)', () => {
    const a = evaluateExit(pos({ heldDays: 25 }));
    expect(a).toMatchObject({ type: 'close', reason: 'time_stop' });
  });

  it('returns close:panic_loss when intraday loss > 7%', () => {
    // entry 100, lastPrice 92.5 → loss 7.5% > 7% threshold.
    // Make currentStop low enough that the hard-stop rule does NOT fire first.
    const a = evaluateExit(pos({ lastPrice: 92.5, currentStop: 90 }));
    expect(a).toMatchObject({ type: 'close', reason: 'panic_loss' });
  });

  it('returns move_stop:trail when rMultiple >= 2.0 and trail moves stop up', () => {
    // lastPrice 120, trail 5% → newStop 114. currentStop 100. 114 > 100 → move.
    // target raised so target_hit doesn't pre-empt trail.
    const a = evaluateExit(pos({ lastPrice: 120, currentStop: 100, target: 130, rMultiple: 2.0 }));
    expect(a).toMatchObject({ type: 'move_stop', reason: 'trail' });
    expect(a.newStop).toBeGreaterThan(100);
  });

  it('does NOT trail when the new stop would not improve current stop', () => {
    // lastPrice 105, trail 5% → newStop 99.75. currentStop already 105 → no improvement.
    // currentStop > lastPrice would actually trigger stop_hit. Use currentStop 100.
    // newStop = max(99.75, 100) = 100. Not > currentStop*1.001 → no move.
    const a = evaluateExit(pos({ lastPrice: 105, currentStop: 100, rMultiple: 2.5 }));
    expect(a.type).not.toBe('move_stop');
  });

  it('returns partial_exit at rMultiple >= 1.5 when not yet taken', () => {
    const a = evaluateExit(pos({ rMultiple: 1.5, quantity: 10, partialTaken: false }));
    expect(a).toMatchObject({ type: 'partial_exit', reason: 'partial_50pct' });
    expect(a.qty).toBe(5);
  });

  it('skips partial_exit when already taken or qty < 2', () => {
    expect(evaluateExit(pos({ rMultiple: 1.5, partialTaken: true })).type).not.toBe('partial_exit');
    expect(evaluateExit(pos({ rMultiple: 1.5, quantity: 1 })).type).not.toBe('partial_exit');
  });

  it('returns move_stop:move_to_be at rMultiple >= 1.0 when not yet moved', () => {
    // Use rMultiple 1.0 exactly. Must NOT trigger partial (rMultiple 1.0 < 1.5).
    // Must NOT trigger trail (1.0 < 2.0). currentStop < entryPrice (95 < 100) → move.
    const a = evaluateExit(pos({ rMultiple: 1.0, beMoved: false }));
    expect(a).toMatchObject({ type: 'move_stop', reason: 'move_to_be', newStop: 100 });
  });

  it('skips BE move when already moved or stop already >= entry', () => {
    expect(evaluateExit(pos({ rMultiple: 1.0, beMoved: true })).type).toBe('hold');
    expect(evaluateExit(pos({ rMultiple: 1.0, currentStop: 102 })).type).toBe('hold');
  });

  it('returns hold when no rule fires', () => {
    const a = evaluateExit(pos({ rMultiple: 0.5, beMoved: false }));
    expect(a.type).toBe('hold');
  });

  it('priority: trail wins over partial wins over BE at the same rMultiple', () => {
    // rMultiple 2.0 triggers trail; partial is skipped even if not yet taken.
    const a = evaluateExit(pos({ lastPrice: 120, currentStop: 100, target: 130, rMultiple: 2.0, partialTaken: false }));
    expect(a.reason).toBe('trail');
  });
});

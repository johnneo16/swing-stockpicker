/**
 * Tests for the error journal.
 *
 * Uses the in-memory DB initialized by tests/setup.js
 * (SWINGPRO_DB=:memory:). Each test cleans the error_log table on entry
 * so order-independence is preserved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordError, recentErrors } from './errorJournal.js';
import { db } from '../persistence/db.js';

beforeEach(() => {
  db.exec('DELETE FROM error_log');
  vi.restoreAllMocks();
});

describe('recordError', () => {
  it('inserts a row with severity, source, message, and stack', async () => {
    const err = new Error('boom');
    const r = await recordError(err, { severity: 'error', source: 'test' });
    expect(r.id).toBeGreaterThan(0);

    const rows = recentErrors(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      severity: 'error',
      source:   'test',
      message:  'boom',
    });
    expect(rows[0].stack).toContain('Error: boom');
  });

  it('serializes a context object into context_json', async () => {
    await recordError(new Error('x'), {
      source:  'job:pre-market',
      context: { symbol: 'INFY', adx: 18, blocked: true },
    });
    const [row] = recentErrors(1);
    expect(row.context).toEqual({ symbol: 'INFY', adx: 18, blocked: true });
  });

  it('handles non-Error inputs by stringifying them', async () => {
    await recordError('plain string', { source: 'test' });
    const [row] = recentErrors(1);
    expect(row.message).toBe('plain string');
    expect(row.stack).toBeNull();
  });

  it('trims very long stacks to 4KB', async () => {
    const err = new Error('huge');
    err.stack = 'X'.repeat(10_000);
    await recordError(err, { source: 'test' });
    const [row] = recentErrors(1);
    expect(row.stack.length).toBeLessThanOrEqual(4096);
  });

  it('does not attempt Telegram alert when severity != critical (default)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await recordError(new Error('routine'), { source: 'test' });
    expect(r.alertSent).toBe(false);
    expect(r.alertReason).toBe('not_requested');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not call Telegram even for critical when client is unconfigured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await recordError(new Error('crash'), { severity: 'critical', source: 'test' });
    // alertSent=false reason=disabled, because TELEGRAM_BOT_TOKEN is unset in tests
    expect(r.alertSent).toBe(false);
    expect(r.alertReason).toBe('disabled');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('recentErrors', () => {
  it('returns rows newest first', async () => {
    await recordError(new Error('first'),  { source: 'a' });
    await recordError(new Error('second'), { source: 'b' });
    await recordError(new Error('third'),  { source: 'c' });
    const rows = recentErrors(10);
    expect(rows.map(r => r.message)).toEqual(['third', 'second', 'first']);
  });

  it('respects the limit argument', async () => {
    for (let i = 0; i < 5; i++) {
      await recordError(new Error(`e${i}`), { source: 't' });
    }
    expect(recentErrors(3)).toHaveLength(3);
  });

  it('filters by severity when provided', async () => {
    await recordError(new Error('warn1'), { severity: 'warning', source: 't' });
    await recordError(new Error('err1'),  { severity: 'error',   source: 't' });
    await recordError(new Error('warn2'), { severity: 'warning', source: 't' });
    const warns = recentErrors(10, 'warning');
    expect(warns).toHaveLength(2);
    expect(warns.every(r => r.severity === 'warning')).toBe(true);
  });
});

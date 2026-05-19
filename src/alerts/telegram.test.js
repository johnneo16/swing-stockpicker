/**
 * Tests for the Telegram alert client.
 *
 * Note: telegram.js reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID at import
 * time and caches the ENABLED flag. To test both the disabled and enabled
 * paths we use vi.resetModules() + vi.stubEnv() to reimport with different
 * env state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('telegram — disabled state (no env vars)', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });

  it('isTelegramConfigured returns false', async () => {
    const mod = await import('./telegram.js');
    expect(mod.isTelegramConfigured()).toBe(false);
  });

  it('sendTelegram no-ops with reason=disabled and does not call fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true });
    const { sendTelegram } = await import('./telegram.js');
    const r = await sendTelegram({ title: 'x', body: 'y' });
    expect(r).toEqual({ sent: false, reason: 'disabled' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('telegram — enabled state (with env vars)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'TEST_TOKEN');
    vi.stubEnv('TELEGRAM_CHAT_ID',   '12345');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('isTelegramConfigured returns true', async () => {
    const mod = await import('./telegram.js');
    expect(mod.isTelegramConfigured()).toBe(true);
  });

  it('sendTelegram posts to the Telegram API with markdown payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 });
    const { sendTelegram } = await import('./telegram.js');
    const r = await sendTelegram({ level: 'critical', title: 'Boom', body: 'something broke' });
    expect(r.sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/api\.telegram\.org\/botTEST_TOKEN\/sendMessage$/);
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('12345');
    expect(body.parse_mode).toBe('Markdown');
    expect(body.text).toContain('🚨');
    expect(body.text).toContain('*Boom*');
    expect(body.text).toContain('something broke');
  });

  it('returns http_XXX on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 429 });
    const { sendTelegram } = await import('./telegram.js');
    const r = await sendTelegram({ title: 'x', body: 'y' });
    expect(r).toMatchObject({ sent: false, reason: 'http_429', http: 429 });
  });

  it('returns reason=exception on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const { sendTelegram } = await import('./telegram.js');
    const r = await sendTelegram({ title: 'x', body: 'y' });
    expect(r).toMatchObject({ sent: false, reason: 'exception' });
  });

  it('throttles duplicate alerts within the dedupe window', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 });
    const { sendTelegram, _resetThrottleForTest } = await import('./telegram.js');
    _resetThrottleForTest();

    const first  = await sendTelegram({ title: 'x', body: 'y', dedupeKey: 'k' });
    const second = await sendTelegram({ title: 'x', body: 'y', dedupeKey: 'k' });
    const otherKey = await sendTelegram({ title: 'x', body: 'y', dedupeKey: 'different' });

    expect(first.sent).toBe(true);
    expect(second).toEqual({ sent: false, reason: 'throttled' });
    expect(otherKey.sent).toBe(true);                       // different key → not throttled
    expect(fetchSpy).toHaveBeenCalledTimes(2);             // only first + different-key
  });

  it('rejects calls with no title', async () => {
    const { sendTelegram } = await import('./telegram.js');
    const r = await sendTelegram({ body: 'orphan body' });
    expect(r).toEqual({ sent: false, reason: 'no_title' });
  });
});

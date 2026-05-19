/**
 * Minimal Telegram bot client for ops alerts.
 *
 * Behavior:
 *   - Env-driven: needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID. Without
 *     either, sendTelegram() no-ops and returns { sent: false, reason: 'disabled' }.
 *     Calling code does not need a feature-flag guard.
 *   - In-process dedupe throttling: passing a `dedupeKey` collapses repeated
 *     alerts within a 15-minute window. Critical alerts that recur are not
 *     hidden — they just don't spam the channel.
 *   - No retries on HTTP failure: an alert that can't reach Telegram is
 *     still written to the error_log via the caller's normal path. Don't
 *     paper over a real outage with retry loops.
 *
 * See docs/RUNBOOK.md §12 (Telegram setup) for bot creation instructions.
 */

const TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID  = process.env.TELEGRAM_CHAT_ID;
const ENABLED  = !!(TOKEN && CHAT_ID);

// Per-process throttling. A restart resets the map; that's fine — a recurring
// post-restart alert is itself a signal worth surfacing.
const sentAt = new Map();
const THROTTLE_MS = 15 * 60 * 1000;

const LEVEL_PREFIX = {
  critical: '🚨',
  error:    '❌',
  warning:  '⚠️',
  info:     'ℹ️',
  success:  '✅',
};

/**
 * Send a single alert to the configured Telegram chat.
 *
 * @param {object} opts
 *   - level:     'critical' | 'error' | 'warning' | 'info' | 'success'  (default 'info')
 *   - title:     short headline; rendered bold
 *   - body:      message body; Markdown-escaped by the caller if it contains user data
 *   - dedupeKey: optional string. If set, repeated alerts with this key
 *                within 15 minutes are suppressed.
 *
 * @returns {Promise<{ sent: boolean, reason?: string, http?: number }>}
 *   - { sent: true } on 200 OK
 *   - { sent: false, reason: 'disabled' } when env vars missing
 *   - { sent: false, reason: 'throttled' } when dedupe window active
 *   - { sent: false, reason: 'http_XXX', http: 429 } on Telegram error
 *   - { sent: false, reason: 'exception' } on network failure
 */
export async function sendTelegram({ level = 'info', title, body, dedupeKey = null } = {}) {
  if (!ENABLED) return { sent: false, reason: 'disabled' };
  if (!title)   return { sent: false, reason: 'no_title' };

  if (dedupeKey) {
    const last = sentAt.get(dedupeKey);
    if (last && Date.now() - last < THROTTLE_MS) {
      return { sent: false, reason: 'throttled' };
    }
  }

  const prefix = LEVEL_PREFIX[level] || LEVEL_PREFIX.info;
  const text   = `${prefix} *${title}*\n\n${body ?? ''}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) {
      return { sent: false, reason: `http_${res.status}`, http: res.status };
    }
    if (dedupeKey) sentAt.set(dedupeKey, Date.now());
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: 'exception', error: err.message };
  }
}

/**
 * Convenience predicate — `if (isTelegramConfigured())` for code paths that
 * want to skip building an expensive message body when alerts are off.
 */
export function isTelegramConfigured() {
  return ENABLED;
}

/**
 * Reset the in-process throttle map. Test-only — exposed so tests can
 * exercise both the first-send and the throttled-send paths.
 */
export function _resetThrottleForTest() {
  sentAt.clear();
}

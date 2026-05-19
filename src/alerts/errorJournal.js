/**
 * Durable error journal — every uncaught error or recoverable failure worth
 * investigating is persisted to the SQLite `error_log` table (created by
 * migration 004).
 *
 * Replaces the prior pattern where errors logged to stdout and were captured
 * only by launchd's redirect into ~/Library/Logs/swingpro.err.log (no
 * structure, no severity, no alert).
 *
 * Severity convention:
 *   - 'critical'  — engine cannot continue, manual attention required.
 *                   Defaults to sending a Telegram alert.
 *   - 'error'     — a job failed but the engine is still healthy. No alert
 *                   by default; caller can opt in with alert: true.
 *   - 'warning'   — degraded state worth recording (e.g. provider fallback).
 */

import { db } from '../persistence/db.js';
import { sendTelegram, isTelegramConfigured } from './telegram.js';

const TRIM_STACK = 4096;

const insertStmt = db.prepare(`
  INSERT INTO error_log (severity, source, message, stack, context_json)
  VALUES (?, ?, ?, ?, ?)
`);

const markAlertedStmt = db.prepare(`UPDATE error_log SET alerted = 1 WHERE id = ?`);

const recentStmt = db.prepare(`
  SELECT id, occurred_at, severity, source, message, stack, context_json, alerted
  FROM error_log
  ORDER BY occurred_at DESC, id DESC
  LIMIT ?
`);

const recentBySeverityStmt = db.prepare(`
  SELECT id, occurred_at, severity, source, message, stack, context_json, alerted
  FROM error_log
  WHERE severity = ?
  ORDER BY occurred_at DESC, id DESC
  LIMIT ?
`);

/**
 * Record an error into the journal and (optionally) send a Telegram alert.
 *
 * @param {Error|string} err
 * @param {object} [opts]
 *   - severity:  'critical' | 'error' | 'warning'  (default 'error')
 *   - source:    free-form tag — 'uncaught', 'job:pre-market', 'killswitch', etc.
 *   - context:   serializable object — extra data for the row
 *   - alert:     force-enable / force-disable Telegram alert. By default,
 *                'critical' alerts; others do not.
 *
 * @returns {Promise<{ id: number, alertSent: boolean, alertReason?: string }>}
 */
export async function recordError(err, opts = {}) {
  const severity = opts.severity || 'error';
  const source   = opts.source   || 'unknown';
  const context  = opts.context  ?? null;
  const shouldAlert = opts.alert !== undefined ? opts.alert : severity === 'critical';

  const message = err?.message ? String(err.message) : String(err);
  const stack   = err?.stack ? String(err.stack).slice(0, TRIM_STACK) : null;
  const contextJson = context ? safeStringify(context) : null;

  const info = insertStmt.run(severity, source, message, stack, contextJson);
  const id   = Number(info.lastInsertRowid);

  if (!shouldAlert || !isTelegramConfigured()) {
    return { id, alertSent: false, alertReason: shouldAlert ? 'disabled' : 'not_requested' };
  }

  const result = await sendTelegram({
    level:     severity,
    title:     `${source} — ${severity.toUpperCase()}`,
    body:      `\`${message}\`\n\nID: ${id}`,
    dedupeKey: `${source}:${message.slice(0, 60)}`,
  });
  if (result.sent) markAlertedStmt.run(id);
  return { id, alertSent: result.sent, alertReason: result.reason };
}

/**
 * Read the N most-recent error_log rows (newest first).
 * Used by the /api/errors endpoint and the Health-tab error widget.
 */
export function recentErrors(limit = 50, severity = null) {
  const rows = severity
    ? recentBySeverityStmt.all(severity, limit)
    : recentStmt.all(limit);
  return rows.map(r => ({
    ...r,
    context: r.context_json ? safeParse(r.context_json) : null,
    alerted: r.alerted === 1,
  }));
}

function safeStringify(obj) {
  try { return JSON.stringify(obj); } catch { return null; }
}
function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

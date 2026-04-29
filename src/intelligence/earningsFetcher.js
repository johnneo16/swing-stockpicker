/**
 * Earnings & corporate-action calendar fetcher.
 *
 * Pulls upcoming NSE board meetings (results / dividend / bonus / split / AGM)
 * from `stock-nse-india`, normalizes them, and writes to the earnings_calendar
 * table so the scan/score pipeline can avoid entering trades right before
 * binary events.
 *
 * Sources:
 *  - PRIMARY: NSE /api/corporate-board-meetings (handled via stock-nse-india)
 *  - FUTURE:  NSE /api/corporates-corporateActions (ex-dates for div/split/bonus)
 *
 * Usage:
 *   import { refreshEarningsCalendar, isEarningsBlackout } from './earningsFetcher.js';
 *   await refreshEarningsCalendar();          // refresh DB cache
 *   isEarningsBlackout('RELIANCE', 2);        // → null or { eventDate, purpose }
 */

import { NseIndia } from 'stock-nse-india';
import { earningsRepo } from '../persistence/db.js';
import STOCK_UNIVERSE          from '../engine/stockUniverse.js';
import STOCK_UNIVERSE_EXTENDED from '../engine/stockUniverseExtended.js';

const nse = new NseIndia();

// Patterns that classify a board meeting purpose
const RESULT_RE   = /financial results|quarterly results|audited results|unaudited results/i;
const DIVIDEND_RE = /dividend/i;
const BONUS_RE    = /bonus/i;
const SPLIT_RE    = /stock split|sub-?division|share split/i;
const AGM_RE      = /annual general meeting|agm/i;

// Build the universe set for filtering — combines live + extended
function buildUniverseSet() {
  const set = new Set();
  for (const s of STOCK_UNIVERSE)         set.add(s.symbol);
  for (const s of STOCK_UNIVERSE_EXTENDED) set.add(s.symbol);
  return set;
}

function classifyPurpose(purpose) {
  const p = (purpose || '').toString();
  if (RESULT_RE.test(p))   return 'earnings';
  if (BONUS_RE.test(p))    return 'bonus';
  if (SPLIT_RE.test(p))    return 'split';
  if (DIVIDEND_RE.test(p)) return 'dividend';
  if (AGM_RE.test(p))      return 'agm';
  return 'board_meeting';
}

/**
 * Parse NSE-style "DD-Mon-YYYY" → "YYYY-MM-DD"
 */
function parseNseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

/**
 * Fetch + persist upcoming board meetings.
 *
 * @param {object} [opts]
 * @param {number} [opts.daysAhead=14]  — how far forward to keep events
 * @param {Set|null} [opts.universe]    — if provided, only persist symbols in this set
 * @returns {Promise<{fetched, kept, byType}>}
 */
export async function refreshEarningsCalendar(opts = {}) {
  const daysAhead = opts.daysAhead ?? 14;
  const universe  = opts.universe ?? buildUniverseSet();

  let meetings;
  try {
    meetings = await nse.getDataByEndpoint('/api/corporate-board-meetings?index=equities');
  } catch (err) {
    console.warn('  ⚠ NSE board-meetings fetch failed:', err.message);
    return { fetched: 0, kept: 0, byType: {} };
  }

  if (!Array.isArray(meetings) || meetings.length === 0) {
    return { fetched: 0, kept: 0, byType: {} };
  }

  const todayMs   = Date.now();
  const cutoffMs  = todayMs + daysAhead * 86400_000;
  let kept = 0;
  const byType = {};

  for (const m of meetings) {
    const symbol = m.bm_symbol;
    if (!symbol || !universe.has(symbol)) continue;

    const eventDate = parseNseDate(m.bm_date);
    if (!eventDate) continue;
    const evMs = new Date(eventDate).getTime();
    if (evMs < todayMs - 86400_000 || evMs > cutoffMs) continue;

    const eventType = classifyPurpose(m.bm_purpose);
    const purpose = m.bm_purpose || m.bm_desc || '';

    earningsRepo.upsert({
      symbol,
      eventDate,
      eventType,
      purpose: purpose.slice(0, 300),
      source: 'nse_board_meetings',
    });
    kept++;
    byType[eventType] = (byType[eventType] || 0) + 1;
  }

  return { fetched: meetings.length, kept, byType };
}

/**
 * Check whether a symbol has any binary event in the next N days.
 * Returns the event details (one most-imminent) or null.
 *
 * @param {string} symbol
 * @param {number} [daysAhead=2]   — blackout window: 2 days = "today + tomorrow"
 * @param {Array<string>} [eventTypes=['earnings']] — types that warrant blackout
 */
export function isEarningsBlackout(symbol, daysAhead = 2, eventTypes = ['earnings']) {
  const event = earningsRepo.hasEventInWindow(symbol, daysAhead);
  if (!event) return null;
  if (eventTypes && !eventTypes.includes(event.event_type)) return null;
  return {
    symbol:    event.symbol,
    eventDate: event.event_date,
    eventType: event.event_type,
    purpose:   event.purpose,
    daysUntil: Math.max(0, Math.round((new Date(event.event_date) - Date.now()) / 86400_000)),
  };
}

/**
 * Get all upcoming events for the universe within a window.
 * Used by /api/events/upcoming.
 */
export function listUpcomingEvents(daysAhead = 14, eventTypes = null) {
  const universe = buildUniverseSet();
  const today  = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + daysAhead * 86400_000).toISOString().slice(0, 10);
  const out = [];
  for (const sym of universe) {
    const events = earningsRepo.upcomingFor(sym, today, cutoff);
    for (const e of events) {
      if (eventTypes && !eventTypes.includes(e.event_type)) continue;
      out.push({
        symbol: e.symbol,
        eventDate: e.event_date,
        eventType: e.event_type,
        purpose: e.purpose,
        daysUntil: Math.max(0, Math.round((new Date(e.event_date) - Date.now()) / 86400_000)),
      });
    }
  }
  out.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  return out;
}

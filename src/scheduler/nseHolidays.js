/**
 * NSE Trading Holiday Calendar
 *
 * Hardcoded annual list — NSE publishes once a year (early January) at:
 *   https://www.nseindia.com/resources/exchange-communication-holidays
 *
 * Update each January for the year ahead. Saturdays and Sundays are
 * handled separately by the weekday check, so only weekday holidays
 * need to be listed here.
 *
 * Each entry: { date: 'YYYY-MM-DD', name: 'reason', segment?: 'equity'|'all' }
 * (Only equity-segment holidays matter for stocks + ETFs. Muhurat trading
 * days are special-cased — markets ARE open for ~1 hour, but we treat
 * them as effectively closed since intraday scans don't fit that window.)
 */

const HOLIDAYS = [
  // 2025 (for historical/replay)
  { date: '2025-01-26', name: 'Republic Day' },        // Sun
  { date: '2025-02-26', name: 'Mahashivratri' },       // Wed
  { date: '2025-03-14', name: 'Holi' },                // Fri
  { date: '2025-03-31', name: 'Eid-ul-Fitr / Ramzan Id' }, // Mon
  { date: '2025-04-10', name: 'Mahavir Jayanti' },     // Thu
  { date: '2025-04-14', name: 'Dr. Ambedkar Jayanti' },// Mon
  { date: '2025-04-18', name: 'Good Friday' },         // Fri
  { date: '2025-05-01', name: 'Maharashtra Day' },     // Thu
  { date: '2025-06-07', name: 'Bakri Id' },            // Sat — already weekend
  { date: '2025-07-06', name: 'Muharram' },            // Sun — already weekend
  { date: '2025-08-15', name: 'Independence Day' },    // Fri
  { date: '2025-08-27', name: 'Ganesh Chaturthi' },    // Wed
  { date: '2025-10-02', name: 'Gandhi Jayanti' },      // Thu
  { date: '2025-10-21', name: 'Diwali Laxmi Pujan' },  // Tue (Muhurat — treated as closed)
  { date: '2025-10-22', name: 'Diwali Balipratipada' },// Wed
  { date: '2025-11-05', name: 'Guru Nanak Jayanti' },  // Wed
  { date: '2025-12-25', name: 'Christmas' },           // Thu

  // 2026 — refresh in January 2026
  { date: '2026-01-26', name: 'Republic Day' },        // Mon
  { date: '2026-02-17', name: 'Mahashivratri' },       // Tue
  { date: '2026-03-05', name: 'Holi' },                // Thu
  { date: '2026-03-31', name: 'Mahavir Jayanti' },     // Tue
  { date: '2026-04-03', name: 'Good Friday' },         // Fri
  { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti' },// Tue
  { date: '2026-05-01', name: 'Maharashtra Day' },     // Fri
  { date: '2026-05-27', name: 'Bakri Id' },            // Wed
  { date: '2026-08-15', name: 'Independence Day' },    // Sat — already weekend
  { date: '2026-08-27', name: 'Ganesh Chaturthi' },    // Thu
  { date: '2026-10-02', name: 'Gandhi Jayanti' },      // Fri
  { date: '2026-11-09', name: 'Diwali Laxmi Pujan' },  // Mon (Muhurat — treated as closed)
  { date: '2026-11-10', name: 'Diwali Balipratipada' },// Tue
  { date: '2026-12-25', name: 'Christmas' },           // Fri

  // 2027 — placeholder, refresh when NSE publishes
];

const holidayMap = new Map(HOLIDAYS.map(h => [h.date, h]));

/**
 * Get today's date in IST as YYYY-MM-DD.
 * Cron jobs run in Asia/Kolkata timezone via node-cron, so this is what
 * the user (and NSE) considers "today."
 */
function todayIST() {
  // Intl-based IST conversion — avoids local-timezone surprises
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Returns the holiday entry if today (IST) is a market holiday, else null.
 * Does NOT cover weekends — caller should also check weekday.
 */
export function getTodayHoliday() {
  return holidayMap.get(todayIST()) || null;
}

/**
 * Returns true if today (IST) is a non-trading day for NSE equity.
 * Combines weekend check + holiday list.
 */
export function isNonTradingDay() {
  // Weekday check using IST locale
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', weekday: 'short',
  }).format(new Date());
  if (weekday === 'Sat' || weekday === 'Sun') return true;
  return holidayMap.has(todayIST());
}

/**
 * Diagnostic — explains WHY today is/isn't a trading day.
 * Used by the scheduler status endpoint + logged in skipped jobs.
 */
export function todayStatus() {
  const date = todayIST();
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', weekday: 'long',
  }).format(new Date());

  if (weekday === 'Saturday' || weekday === 'Sunday') {
    return { date, weekday, isTradingDay: false, reason: 'weekend' };
  }
  const holiday = holidayMap.get(date);
  if (holiday) {
    return { date, weekday, isTradingDay: false, reason: 'holiday', holidayName: holiday.name };
  }
  return { date, weekday, isTradingDay: true };
}

/**
 * Get the next N trading days from the calendar (excluding today if it's
 * a non-trading day). Useful for the UI to show "Next pre-market: ..."
 */
export function nextTradingDays(n = 3, from = null) {
  const start = from ? new Date(from) : new Date();
  const out = [];
  let cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1); // start from tomorrow

  while (out.length < n) {
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(cursor);
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata', weekday: 'short',
    }).format(cursor);

    if (weekday !== 'Sat' && weekday !== 'Sun' && !holidayMap.has(dateStr)) {
      out.push({ date: dateStr, weekday: weekday });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    // Safety brake — don't loop forever
    if (cursor - start > 30 * 86400000) break;
  }
  return out;
}

/**
 * Upcoming holidays within N days from today — useful for UI banner.
 */
export function upcomingHolidays(daysAhead = 30) {
  const todayMs = Date.parse(todayIST() + 'T00:00:00');
  const cutoff = todayMs + daysAhead * 86400000;
  return HOLIDAYS
    .filter(h => {
      const ms = Date.parse(h.date + 'T00:00:00');
      return ms >= todayMs && ms <= cutoff;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export { HOLIDAYS, todayIST };

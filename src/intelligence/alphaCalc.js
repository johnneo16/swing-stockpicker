/**
 * Portfolio alpha vs Nifty 50 over a rolling window.
 *
 * Replaces the gut-feel "I'm losing in a bullish market" anxiety with a
 * single number. Shown as a tile in the dashboard.
 *
 * Formula (raw, conservative):
 *   alpha_pct = portfolio_pnl_pct − nifty_change_pct
 *
 * portfolio_pnl_pct = SUM(realized_pnl over window) / starting_capital × 100
 *   Considers only CLOSED trades in the window. Open positions don't count
 *   (their P&L isn't realized — including them would let unrealized swings
 *   move the alpha number erratically).
 *
 * nifty_change_pct = (today_close − window_start_close) / window_start_close × 100
 *
 * Why raw (not exposure-adjusted): if the system is going to make real money
 * it has to do so net of "but I was only 50% deployed". Raw alpha is a
 * stricter, more honest bar — and matches how the user reads "Nifty is up X,
 * my portfolio is up Y" intuitively.
 *
 * Returns:
 *   {
 *     windowDays,
 *     portfolioPnlPct,
 *     niftyChangePct,
 *     alphaPct,
 *     tradesInWindow,
 *     niftyStartClose, niftyEndClose,
 *     hasData: boolean
 *   }
 * hasData=false when either side lacks data (fresh DB, no Nifty context, etc.).
 */

import { db } from '../persistence/db.js';

/**
 * Compute portfolio alpha vs Nifty over a rolling window.
 * @param {object} opts
 * @param {string} [opts.mode='paper']  'paper' or 'live'
 * @param {string} [opts.assetClass]    optional asset class filter
 * @param {number} [opts.windowDays=30]
 * @param {number} [opts.startingCapital=50000]
 * @returns {object} alpha snapshot — see file docstring
 */
export function computePortfolioAlpha({
  mode = 'paper',
  assetClass = null,
  windowDays = 30,
  startingCapital = 50000,
} = {}) {
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();

  // Portfolio P&L from closed trades in the window.
  const portfolioRow = assetClass
    ? db.prepare(`
        SELECT
          COALESCE(SUM(realized_pnl), 0) AS total_pnl,
          COUNT(*) AS n
        FROM trades
        WHERE status='closed' AND mode=? AND asset_class=? AND exit_date >= ?
      `).get(mode, assetClass, cutoff)
    : db.prepare(`
        SELECT
          COALESCE(SUM(realized_pnl), 0) AS total_pnl,
          COUNT(*) AS n
        FROM trades
        WHERE status='closed' AND mode=? AND exit_date >= ?
      `).get(mode, cutoff);

  const portfolioPnl = portfolioRow?.total_pnl ?? 0;
  const tradesInWindow = portfolioRow?.n ?? 0;
  const portfolioPnlPct = startingCapital > 0
    ? (portfolioPnl / startingCapital) * 100
    : 0;

  // Nifty change over the window from market_context table.
  // Use the OLDEST row in-window as the start and the NEWEST as the end —
  // covers the case where the user doesn't have a row exactly at "30 days ago".
  const cutoffDate = cutoff.slice(0, 10);
  const niftyRows = db.prepare(`
    SELECT date, nifty_close
    FROM market_context
    WHERE date >= ? AND nifty_close IS NOT NULL
    ORDER BY date ASC
  `).all(cutoffDate);

  let niftyChangePct = null;
  let niftyStartClose = null;
  let niftyEndClose = null;
  if (niftyRows.length >= 2) {
    niftyStartClose = niftyRows[0].nifty_close;
    niftyEndClose   = niftyRows[niftyRows.length - 1].nifty_close;
    niftyChangePct  = ((niftyEndClose - niftyStartClose) / niftyStartClose) * 100;
  }

  const hasData = niftyChangePct != null && tradesInWindow > 0;
  const alphaPct = hasData ? portfolioPnlPct - niftyChangePct : null;

  return {
    windowDays,
    portfolioPnlPct: round2(portfolioPnlPct),
    portfolioPnlRupees: Math.round(portfolioPnl),
    niftyChangePct: niftyChangePct != null ? round2(niftyChangePct) : null,
    alphaPct: alphaPct != null ? round2(alphaPct) : null,
    tradesInWindow,
    niftyStartClose,
    niftyEndClose,
    startingCapital,
    hasData,
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

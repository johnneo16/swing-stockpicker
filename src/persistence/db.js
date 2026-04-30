/**
 * SQLite persistence layer for SwingPro.
 *
 * Tables:
 *  - trades            : every trade ever taken (paper + live)
 *  - positions         : currently open positions (lifecycle state)
 *  - scans             : every scan run, with scored picks
 *  - market_context    : daily VIX / FII-DII / breadth / regime tag
 *  - earnings_calendar : upcoming corporate events per stock
 *  - backtest_runs     : every backtest execution + summary metrics
 *  - backtest_trades   : individual simulated trades from backtest_runs
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Resolve project root from src/persistence/ → project root
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR     = path.join(PROJECT_ROOT, 'data');
const DB_PATH      = process.env.SWINGPRO_DB || path.join(DATA_DIR, 'swingpro.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');     // better concurrency
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');   // good speed/safety balance

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

db.exec(`
CREATE TABLE IF NOT EXISTS trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol          TEXT NOT NULL,
  name            TEXT,
  sector          TEXT,
  setup_type      TEXT,
  mode            TEXT NOT NULL DEFAULT 'paper',           -- 'paper' | 'live'
  entry_date      TEXT NOT NULL,                            -- ISO 8601
  entry_price     REAL NOT NULL,
  initial_stop    REAL NOT NULL,
  target_price    REAL NOT NULL,
  current_stop    REAL NOT NULL,
  quantity        INTEGER NOT NULL,
  capital         REAL NOT NULL,
  risk_amount     REAL NOT NULL,
  confidence      REAL,
  rr_planned      REAL,
  est_days        INTEGER,

  status          TEXT NOT NULL DEFAULT 'open',             -- 'open' | 'closed'
  exit_date       TEXT,
  exit_price      REAL,
  exit_reason     TEXT,                                     -- 'stop' | 'target' | 'time' | 'manual' | 'trail'
  realized_pnl    REAL,
  realized_pct    REAL,
  holding_days    INTEGER,

  partial_exits   TEXT,                                     -- JSON array
  notes           TEXT,
  metadata        TEXT,                                     -- JSON blob

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol_status ON trades(symbol, status);
CREATE INDEX IF NOT EXISTS idx_trades_entry_date    ON trades(entry_date);
CREATE INDEX IF NOT EXISTS idx_trades_mode_status   ON trades(mode, status);

CREATE TABLE IF NOT EXISTS positions (
  trade_id          INTEGER PRIMARY KEY,
  last_price        REAL,
  last_price_at     TEXT,
  unrealized_pnl    REAL,
  unrealized_pct    REAL,
  highest_close     REAL,
  trail_active      INTEGER NOT NULL DEFAULT 0,
  be_moved          INTEGER NOT NULL DEFAULT 0,
  partial_taken     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scanned_at      TEXT NOT NULL DEFAULT (datetime('now')),
  capital         REAL,
  scan_type       TEXT NOT NULL DEFAULT 'stock',            -- 'stock' | 'etf' | 'backtest'
  total_picks     INTEGER,
  trade_count     INTEGER,
  avg_score       REAL,
  market_mood     TEXT,
  regime          TEXT,
  payload_json    TEXT NOT NULL                             -- full scan result
);

CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans(scanned_at);

CREATE TABLE IF NOT EXISTS market_context (
  date            TEXT PRIMARY KEY,                         -- YYYY-MM-DD
  nifty_close     REAL,
  nifty_change    REAL,
  vix             REAL,
  vix_change      REAL,
  fii_net         REAL,
  dii_net         REAL,
  advances        INTEGER,
  declines        INTEGER,
  pcr             REAL,
  regime          TEXT,                                     -- 'risk_on' | 'risk_off' | 'neutral'
  trend           TEXT,                                     -- 'bullish' | 'bearish' | 'sideways'
  volatility      TEXT,                                     -- 'low' | 'normal' | 'high'
  raw_json        TEXT,
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS earnings_calendar (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol          TEXT NOT NULL,
  event_date      TEXT NOT NULL,
  event_type      TEXT,                                     -- 'earnings' | 'dividend' | 'agm' | 'bonus' | 'split' | 'board_meeting'
  purpose         TEXT,
  source          TEXT,
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, event_date, event_type)
);

CREATE INDEX IF NOT EXISTS idx_earnings_symbol_date ON earnings_calendar(symbol, event_date);
CREATE INDEX IF NOT EXISTS idx_earnings_event_date  ON earnings_calendar(event_date);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,
  capital         REAL NOT NULL,
  universe_size   INTEGER,
  config_json     TEXT,
  -- Summary metrics
  total_trades    INTEGER,
  wins            INTEGER,
  losses          INTEGER,
  win_rate        REAL,
  avg_win_pct     REAL,
  avg_loss_pct    REAL,
  expectancy_pct  REAL,
  total_return    REAL,
  total_return_pct REAL,
  max_drawdown_pct REAL,
  sharpe_ratio    REAL,
  profit_factor   REAL,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER NOT NULL,
  symbol          TEXT NOT NULL,
  setup_type      TEXT,
  entry_date      TEXT NOT NULL,
  entry_price     REAL NOT NULL,
  exit_date       TEXT,
  exit_price      REAL,
  exit_reason     TEXT,
  quantity        INTEGER,
  realized_pnl    REAL,
  realized_pct    REAL,
  holding_days    INTEGER,
  confidence      REAL,
  rr_planned      REAL,
  rr_realized     REAL,
  metadata        TEXT,
  FOREIGN KEY (run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bt_trades_run_id ON backtest_trades(run_id);
CREATE INDEX IF NOT EXISTS idx_bt_trades_symbol ON backtest_trades(symbol);
`);

// ─────────────────────────────────────────────────────────────────────────────
// PREPARED STATEMENTS — TRADES
// ─────────────────────────────────────────────────────────────────────────────

const insertTradeStmt = db.prepare(`
INSERT INTO trades (
  symbol, name, sector, setup_type, mode,
  entry_date, entry_price, initial_stop, target_price, current_stop,
  quantity, capital, risk_amount, confidence, rr_planned, est_days,
  metadata
) VALUES (
  @symbol, @name, @sector, @setup_type, @mode,
  @entry_date, @entry_price, @initial_stop, @target_price, @current_stop,
  @quantity, @capital, @risk_amount, @confidence, @rr_planned, @est_days,
  @metadata
)
`);

const closeTradeStmt = db.prepare(`
UPDATE trades SET
  status        = 'closed',
  exit_date     = @exit_date,
  exit_price    = @exit_price,
  exit_reason   = @exit_reason,
  realized_pnl  = @realized_pnl,
  realized_pct  = @realized_pct,
  holding_days  = @holding_days,
  updated_at    = datetime('now')
WHERE id = @id
`);

const updateStopStmt = db.prepare(`
UPDATE trades SET current_stop = @stop, updated_at = datetime('now') WHERE id = @id
`);

const getOpenTradesStmt = db.prepare(`
SELECT * FROM trades WHERE status = 'open' AND mode = ? ORDER BY entry_date DESC
`);

const getTradeByIdStmt = db.prepare(`SELECT * FROM trades WHERE id = ?`);

const getTradeBySymbolOpenStmt = db.prepare(`
SELECT * FROM trades WHERE symbol = ? AND status = 'open' AND mode = ? LIMIT 1
`);

const getClosedTradesStmt = db.prepare(`
SELECT * FROM trades WHERE status = 'closed' AND mode = ? ORDER BY exit_date DESC LIMIT ?
`);

// ─────────────────────────────────────────────────────────────────────────────
// PREPARED STATEMENTS — POSITIONS
// ─────────────────────────────────────────────────────────────────────────────

const upsertPositionStmt = db.prepare(`
INSERT INTO positions (trade_id, last_price, last_price_at, unrealized_pnl, unrealized_pct, highest_close, trail_active, be_moved, partial_taken)
VALUES (@trade_id, @last_price, @last_price_at, @unrealized_pnl, @unrealized_pct, @highest_close, @trail_active, @be_moved, @partial_taken)
ON CONFLICT(trade_id) DO UPDATE SET
  last_price     = excluded.last_price,
  last_price_at  = excluded.last_price_at,
  unrealized_pnl = excluded.unrealized_pnl,
  unrealized_pct = excluded.unrealized_pct,
  highest_close  = MAX(positions.highest_close, excluded.highest_close),
  trail_active   = excluded.trail_active,
  be_moved       = excluded.be_moved,
  partial_taken  = excluded.partial_taken
`);

const getPositionStmt = db.prepare(`SELECT * FROM positions WHERE trade_id = ?`);

const deletePositionStmt = db.prepare(`DELETE FROM positions WHERE trade_id = ?`);

// ─────────────────────────────────────────────────────────────────────────────
// PREPARED STATEMENTS — SCANS
// ─────────────────────────────────────────────────────────────────────────────

const insertScanStmt = db.prepare(`
INSERT INTO scans (capital, scan_type, total_picks, trade_count, avg_score, market_mood, regime, payload_json)
VALUES (@capital, @scan_type, @total_picks, @trade_count, @avg_score, @market_mood, @regime, @payload_json)
`);

const recentScansStmt = db.prepare(`
SELECT id, scanned_at, scan_type, capital, total_picks, trade_count, avg_score, market_mood, regime
FROM scans ORDER BY scanned_at DESC LIMIT ?
`);

// ─────────────────────────────────────────────────────────────────────────────
// PREPARED STATEMENTS — MARKET CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

const upsertMarketContextStmt = db.prepare(`
INSERT INTO market_context (date, nifty_close, nifty_change, vix, vix_change, fii_net, dii_net, advances, declines, pcr, regime, trend, volatility, raw_json)
VALUES (@date, @nifty_close, @nifty_change, @vix, @vix_change, @fii_net, @dii_net, @advances, @declines, @pcr, @regime, @trend, @volatility, @raw_json)
ON CONFLICT(date) DO UPDATE SET
  nifty_close = excluded.nifty_close, nifty_change = excluded.nifty_change,
  vix = excluded.vix, vix_change = excluded.vix_change,
  fii_net = excluded.fii_net, dii_net = excluded.dii_net,
  advances = excluded.advances, declines = excluded.declines,
  pcr = excluded.pcr, regime = excluded.regime,
  trend = excluded.trend, volatility = excluded.volatility,
  raw_json = excluded.raw_json, fetched_at = datetime('now')
`);

const getMarketContextStmt = db.prepare(`SELECT * FROM market_context WHERE date = ?`);

// ─────────────────────────────────────────────────────────────────────────────
// PREPARED STATEMENTS — EARNINGS CALENDAR
// ─────────────────────────────────────────────────────────────────────────────

const upsertEarningStmt = db.prepare(`
INSERT INTO earnings_calendar (symbol, event_date, event_type, purpose, source)
VALUES (@symbol, @event_date, @event_type, @purpose, @source)
ON CONFLICT(symbol, event_date, event_type) DO UPDATE SET
  purpose = excluded.purpose, source = excluded.source, fetched_at = datetime('now')
`);

const upcomingEventsForSymbolStmt = db.prepare(`
SELECT * FROM earnings_calendar
WHERE symbol = ? AND event_date >= ? AND event_date <= ?
ORDER BY event_date ASC
`);

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export const tradesRepo = {
  open(trade) {
    const result = insertTradeStmt.run({
      symbol: trade.symbol,
      name: trade.name || null,
      sector: trade.sector || null,
      setup_type: trade.setupType || null,
      mode: trade.mode || 'paper',
      entry_date: trade.entryDate || new Date().toISOString(),
      entry_price: trade.entryPrice,
      initial_stop: trade.stopLoss,
      target_price: trade.targetPrice,
      current_stop: trade.stopLoss,
      quantity: trade.quantity,
      capital: trade.capitalRequired,
      risk_amount: trade.riskAmount,
      confidence: trade.confidenceScore || null,
      rr_planned: trade.riskRewardRatio || null,
      est_days: trade.estimatedDays || null,
      metadata: JSON.stringify(trade.metadata || {}),
    });
    return result.lastInsertRowid;
  },

  close(id, { exitDate, exitPrice, exitReason, entryPrice, quantity, entryDate }) {
    const trade = getTradeByIdStmt.get(id);
    const ep = entryPrice ?? trade.entry_price;
    const qty = quantity ?? trade.quantity;
    const realized_pnl = (exitPrice - ep) * qty;
    const realized_pct = ((exitPrice - ep) / ep) * 100;
    const ed = entryDate ?? trade.entry_date;
    const holding_days = Math.max(1, Math.round((new Date(exitDate) - new Date(ed)) / (1000 * 60 * 60 * 24)));
    closeTradeStmt.run({
      id, exit_date: exitDate, exit_price: exitPrice, exit_reason: exitReason,
      realized_pnl: Math.round(realized_pnl * 100) / 100,
      realized_pct: Math.round(realized_pct * 100) / 100,
      holding_days,
    });
    deletePositionStmt.run(id);
    return { realized_pnl, realized_pct, holding_days };
  },

  updateStop(id, stop) { updateStopStmt.run({ id, stop }); },
  getOpen(mode = 'paper') { return getOpenTradesStmt.all(mode); },
  getById(id) { return getTradeByIdStmt.get(id); },
  getOpenBySymbol(symbol, mode = 'paper') { return getTradeBySymbolOpenStmt.get(symbol, mode); },
  getRecentClosed(mode = 'paper', limit = 50) { return getClosedTradesStmt.all(mode, limit); },

  /**
   * Aggregate journal stats over closed trades (paper or live).
   * Mirrors backtest metrics so we can compare predicted vs actual edge.
   */
  journalStats(mode = 'paper') {
    const closed = db.prepare(
      `SELECT * FROM trades WHERE status='closed' AND mode = ? ORDER BY exit_date ASC`
    ).all(mode);
    if (closed.length === 0) return { mode, totalTrades: 0, wins: 0, losses: 0 };

    const wins   = closed.filter(t => (t.realized_pnl || 0) > 0);
    const losses = closed.filter(t => (t.realized_pnl || 0) < 0);
    const win_rate = closed.length > 0 ? wins.length / closed.length : 0;
    const avgWinPct  = wins.length   ? wins.reduce((s, t) => s + (t.realized_pct || 0), 0) / wins.length : 0;
    const avgLossPct = losses.length ? losses.reduce((s, t) => s + (t.realized_pct || 0), 0) / losses.length : 0;
    const expectancyPct = win_rate * avgWinPct + (1 - win_rate) * avgLossPct;
    const totalPnl    = closed.reduce((s, t) => s + (t.realized_pnl || 0), 0);
    const grossProfit = wins.reduce((s, t) => s + (t.realized_pnl || 0), 0);
    const grossLoss   = Math.abs(losses.reduce((s, t) => s + (t.realized_pnl || 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
    const avgHolding  = closed.reduce((s, t) => s + (t.holding_days || 0), 0) / closed.length;

    // Equity curve trade-by-trade
    const open = db.prepare(`SELECT * FROM trades WHERE status='open' AND mode = ?`).all(mode);
    const startingCapital = closed[0]?.capital ? closed[0].capital : 50000;
    let equity = startingCapital, peak = startingCapital, maxDD = 0;
    const curve = [];
    for (const t of closed) {
      equity += (t.realized_pnl || 0);
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
      if (dd > maxDD) maxDD = dd;
      curve.push({ date: (t.exit_date || '').slice(0, 10), equity: Math.round(equity * 100) / 100 });
    }

    // By setup type
    const bySetup = {};
    for (const t of closed) {
      const k = t.setup_type || 'unknown';
      (bySetup[k] ??= { n: 0, wins: 0, totalPct: 0, totalPnl: 0 });
      bySetup[k].n++;
      if ((t.realized_pnl || 0) > 0) bySetup[k].wins++;
      bySetup[k].totalPct += t.realized_pct || 0;
      bySetup[k].totalPnl += t.realized_pnl || 0;
    }
    for (const k of Object.keys(bySetup)) {
      const v = bySetup[k];
      v.winRate    = v.n > 0 ? v.wins / v.n : 0;
      v.expectancy = v.n > 0 ? v.totalPct / v.n : 0;
    }

    // By exit reason
    const byExit = {};
    for (const t of closed) byExit[t.exit_reason || 'unknown'] = (byExit[t.exit_reason || 'unknown'] || 0) + 1;

    return {
      mode,
      totalTrades:    closed.length,
      openTrades:     open.length,
      wins:           wins.length,
      losses:         losses.length,
      winRate:        Math.round(win_rate * 10000) / 10000,
      avgWinPct:      Math.round(avgWinPct * 100) / 100,
      avgLossPct:     Math.round(avgLossPct * 100) / 100,
      expectancyPct:  Math.round(expectancyPct * 100) / 100,
      profitFactor:   profitFactor != null ? Math.round(profitFactor * 100) / 100 : null,
      totalPnl:       Math.round(totalPnl * 100) / 100,
      avgHoldingDays: Math.round(avgHolding * 10) / 10,
      maxDrawdownPct: Math.round(maxDD * 100) / 100,
      finalEquity:    Math.round(equity * 100) / 100,
      startingCapital,
      bySetup,
      byExit,
      equityCurve:    curve.slice(-100),
    };
  },
};

export const positionsRepo = {
  upsert(position) {
    upsertPositionStmt.run({
      trade_id:       position.tradeId,
      last_price:     position.lastPrice,
      last_price_at:  position.lastPriceAt || new Date().toISOString(),
      unrealized_pnl: position.unrealizedPnl,
      unrealized_pct: position.unrealizedPct,
      highest_close:  position.highestClose ?? position.lastPrice,
      trail_active:   position.trailActive ? 1 : 0,
      be_moved:       position.beMoved ? 1 : 0,
      partial_taken:  position.partialTaken ? 1 : 0,
    });
  },
  get(tradeId) { return getPositionStmt.get(tradeId); },
  delete(tradeId) { deletePositionStmt.run(tradeId); },
};

export const scansRepo = {
  save(scan) {
    const result = insertScanStmt.run({
      capital: scan.capital || null,
      scan_type: scan.scanType || 'stock',
      total_picks: scan.totalPicks || null,
      trade_count: scan.trades?.length || 0,
      avg_score: scan.trades?.length ? scan.trades.reduce((s, t) => s + (t.confidenceScore || 0), 0) / scan.trades.length : null,
      market_mood: scan.marketContext?.marketMood || null,
      regime: scan.regime || null,
      payload_json: JSON.stringify(scan),
    });
    return result.lastInsertRowid;
  },
  recent(limit = 20) { return recentScansStmt.all(limit); },
};

export const marketContextRepo = {
  upsert(ctx) {
    upsertMarketContextStmt.run({
      date: ctx.date,
      nifty_close: ctx.niftyClose ?? null,
      nifty_change: ctx.niftyChange ?? null,
      vix: ctx.vix ?? null,
      vix_change: ctx.vixChange ?? null,
      fii_net: ctx.fiiNet ?? null,
      dii_net: ctx.diiNet ?? null,
      advances: ctx.advances ?? null,
      declines: ctx.declines ?? null,
      pcr: ctx.pcr ?? null,
      regime: ctx.regime ?? null,
      trend: ctx.trend ?? null,
      volatility: ctx.volatility ?? null,
      raw_json: JSON.stringify(ctx.raw || {}),
    });
  },
  get(date) { return getMarketContextStmt.get(date); },
};

export const earningsRepo = {
  upsert(event) {
    upsertEarningStmt.run({
      symbol: event.symbol,
      event_date: event.eventDate,
      event_type: event.eventType || 'earnings',
      purpose: event.purpose || null,
      source: event.source || 'manual',
    });
  },
  upcomingFor(symbol, fromDate, toDate) {
    return upcomingEventsForSymbolStmt.all(symbol, fromDate, toDate);
  },
  hasEventInWindow(symbol, days = 2) {
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const events = upcomingEventsForSymbolStmt.all(symbol, today, cutoff);
    return events.length > 0 ? events[0] : null;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// BACKTEST PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

const insertBacktestRunStmt = db.prepare(`
INSERT INTO backtest_runs (start_date, end_date, capital, universe_size, config_json, notes)
VALUES (@start_date, @end_date, @capital, @universe_size, @config_json, @notes)
`);

const finishBacktestRunStmt = db.prepare(`
UPDATE backtest_runs SET
  finished_at = datetime('now'),
  total_trades = @total_trades, wins = @wins, losses = @losses,
  win_rate = @win_rate, avg_win_pct = @avg_win_pct, avg_loss_pct = @avg_loss_pct,
  expectancy_pct = @expectancy_pct, total_return = @total_return, total_return_pct = @total_return_pct,
  max_drawdown_pct = @max_drawdown_pct, sharpe_ratio = @sharpe_ratio, profit_factor = @profit_factor
WHERE id = @id
`);

const insertBacktestTradeStmt = db.prepare(`
INSERT INTO backtest_trades (
  run_id, symbol, setup_type, entry_date, entry_price, exit_date, exit_price,
  exit_reason, quantity, realized_pnl, realized_pct, holding_days,
  confidence, rr_planned, rr_realized, metadata
) VALUES (
  @run_id, @symbol, @setup_type, @entry_date, @entry_price, @exit_date, @exit_price,
  @exit_reason, @quantity, @realized_pnl, @realized_pct, @holding_days,
  @confidence, @rr_planned, @rr_realized, @metadata
)
`);

const insertBacktestTradesMany = db.transaction((runId, trades) => {
  for (const t of trades) {
    insertBacktestTradeStmt.run({
      run_id: runId,
      symbol: t.symbol,
      setup_type: t.setupType || null,
      entry_date: t.entryDate,
      entry_price: t.entryPrice,
      exit_date: t.exitDate,
      exit_price: t.exitPrice,
      exit_reason: t.exitReason,
      quantity: t.quantity || 1,
      realized_pnl: t.realizedPnl,
      realized_pct: t.realizedPct,
      holding_days: t.holdingDays,
      confidence: t.confidence || null,
      rr_planned: t.rrPlanned || null,
      rr_realized: t.rrRealized || null,
      metadata: JSON.stringify(t.metadata || {}),
    });
  }
});

export const backtestRepo = {
  start({ startDate, endDate, capital, universeSize, config, notes }) {
    const r = insertBacktestRunStmt.run({
      start_date: startDate, end_date: endDate, capital,
      universe_size: universeSize || null,
      config_json: JSON.stringify(config || {}),
      notes: notes || null,
    });
    return r.lastInsertRowid;
  },
  finish(id, metrics) { finishBacktestRunStmt.run({ id, ...metrics }); },
  saveTrades(runId, trades) { insertBacktestTradesMany(runId, trades); },
  list(limit = 20) {
    return db.prepare(`SELECT * FROM backtest_runs ORDER BY started_at DESC LIMIT ?`).all(limit);
  },
  get(id) {
    const run = db.prepare(`SELECT * FROM backtest_runs WHERE id = ?`).get(id);
    if (!run) return null;
    const trades = db.prepare(`SELECT * FROM backtest_trades WHERE run_id = ? ORDER BY entry_date`).all(id);
    return { ...run, trades };
  },
};

export function dbHealthCheck() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
  return { ok: true, tables: tables.map(t => t.name), path: DB_PATH };
}

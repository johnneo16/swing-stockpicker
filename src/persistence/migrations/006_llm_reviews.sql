-- Migration 006: LLM-driven review tables.
-- Powers the earnings-preview + stale-trade-review skills ported from
-- the equity-research plugin marketplace.

CREATE TABLE IF NOT EXISTS earnings_previews (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id            INTEGER NOT NULL,
  symbol              TEXT NOT NULL,
  earnings_date       TEXT NOT NULL,
  days_to_earnings    INTEGER NOT NULL,
  current_pnl_pct     REAL,
  recommendation      TEXT NOT NULL,  -- HOLD | TRIM_50 | EXIT
  confidence_level    TEXT NOT NULL,  -- LOW | MEDIUM | HIGH
  rationale           TEXT NOT NULL,
  key_risks_json      TEXT,           -- JSON array of strings
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  alerted             INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ep_trade ON earnings_previews(trade_id);
CREATE INDEX IF NOT EXISTS idx_ep_created ON earnings_previews(created_at DESC);

CREATE TABLE IF NOT EXISTS stale_trade_reviews (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id            INTEGER NOT NULL,
  symbol              TEXT NOT NULL,
  days_held           INTEGER NOT NULL,
  est_days            INTEGER,
  pnl_pct             REAL NOT NULL,
  recommendation      TEXT NOT NULL,  -- CONTINUE_HOLD | TIGHTEN_STOP | EXIT
  thesis_still_intact INTEGER,        -- 0 or 1
  pillars_status_json TEXT,           -- JSON: {pillar: status}
  rationale           TEXT NOT NULL,
  suggested_stop      REAL,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  alerted             INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_str_trade ON stale_trade_reviews(trade_id);
CREATE INDEX IF NOT EXISTS idx_str_created ON stale_trade_reviews(created_at DESC);

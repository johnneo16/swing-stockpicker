-- 003: Asset-class tagging across trades, daily_picks, and backtest_runs.
-- Enables per-class capital pools (stocks ₹50K, ETFs ₹25K) and per-class
-- backtest result filtering.
-- Values: 'stock' | 'etf' | 'commodity' (commodity is deferred).
-- Backfills as 'stock' for any pre-existing row.

ALTER TABLE trades         ADD COLUMN asset_class TEXT DEFAULT 'stock';
ALTER TABLE daily_picks    ADD COLUMN asset_class TEXT DEFAULT 'stock';
ALTER TABLE backtest_runs  ADD COLUMN asset_class TEXT DEFAULT 'stock';

CREATE INDEX IF NOT EXISTS idx_trades_asset_status ON trades(asset_class, status, mode);
CREATE INDEX IF NOT EXISTS idx_picks_date_class    ON daily_picks(pick_date, asset_class);

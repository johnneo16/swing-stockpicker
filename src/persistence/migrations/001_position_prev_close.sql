-- 001: Add prev_close and day_change_pct columns to positions table.
-- These power the "today's P&L" calculation on the Live tab.
-- Pre-existing DBs already have these via the legacy safeAlter pattern;
-- the migrator's legacy-prime path marks this as applied automatically.

ALTER TABLE positions ADD COLUMN prev_close REAL;
ALTER TABLE positions ADD COLUMN day_change_pct REAL;

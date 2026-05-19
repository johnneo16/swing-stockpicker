-- 004: Error journal — durable record of every error worth investigating.
--
-- Replaces the prior pattern where uncaught exceptions silently exited the
-- process and got picked up only by launchd KeepAlive logs in
-- ~/Library/Logs/swingpro.err.log (no DB record, no alert).
--
-- Populated by src/alerts/errorJournal.js → recordError():
--   - process.on('uncaughtException' / 'unhandledRejection') in server.js
--   - orchestrator catch-blocks in src/scheduler/orchestrator.js
--   - explicit calls from job handlers when a recoverable error occurs
--
-- The `alerted` flag is set to 1 after a successful Telegram send so the
-- UI / readers can show "alert delivered" without re-pinging.
--
-- ANSI-SQL compatible per src/persistence/migrator.js preamble (no
-- AUTOINCREMENT, no datetime() — INTEGER PRIMARY KEY is rowid alias on
-- SQLite, equivalent to SERIAL on Postgres at port-time).

CREATE TABLE IF NOT EXISTS error_log (
  id           INTEGER PRIMARY KEY,
  occurred_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  severity     TEXT    NOT NULL,    -- 'critical' | 'error' | 'warning'
  source       TEXT    NOT NULL,    -- 'uncaught' | 'job:<id>' | 'killswitch' | etc.
  message      TEXT    NOT NULL,
  stack        TEXT,                -- trimmed to 4KB
  context_json TEXT,                -- JSON-encoded contextual data
  alerted      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_error_log_occurred_at ON error_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_severity    ON error_log(severity);

// Vitest global setup — runs before any test file imports anything.
//
// Anything imported by the modules under test must not touch the production
// SQLite DB. We force a fresh in-memory DB per test process so DB-backed
// modules (exitEngine, positionTracker, scoringEngine via riskEngine) can
// still be import-tested without polluting data/swingpro.db.
process.env.SWINGPRO_DB        = ':memory:';
process.env.NODE_ENV           = 'test';
process.env.LOG_LEVEL          = 'error';     // hush log noise in test output
process.env.LOG_STDOUT_ONLY    = '1';         // skip the file transport in pino
process.env.DISABLE_LOG_SHIM   = '1';         // don't hijack console.* during tests

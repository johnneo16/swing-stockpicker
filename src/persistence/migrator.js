/**
 * Versioned DB migration runner.
 *
 * Replaces the ad-hoc safeAlter() pattern with a numbered migrations
 * directory. Each migration is a single .sql file under
 *   src/persistence/migrations/NNN_description.sql
 *
 * Migrations are applied in numeric order, exactly once. A
 * schema_migrations table tracks which versions have run.
 *
 * Cloud-portability: each migration must use ANSI-SQL compatible
 * with both SQLite (current) and Postgres (future cloud target).
 * Specifically AVOID:
 *   - AUTOINCREMENT  (use the rowid alias on SQLite, SERIAL on Postgres —
 *                     for now we live with SQLite-specific in the baseline,
 *                     but new migrations should be ANSI)
 *   - datetime('now')  → use CURRENT_TIMESTAMP
 *   - REAL  → use DOUBLE PRECISION (or NUMERIC where appropriate)
 *
 * Behavior on first run:
 *   - If schema_migrations table doesn't exist yet AND the trades table
 *     already exists → assume all baseline migrations have been applied
 *     via the legacy CREATE TABLE IF NOT EXISTS + safeAlter flow, and
 *     mark every known migration as already applied (no-op recovery).
 *     This makes the rollout backward-compatible with existing DBs.
 *   - If neither exists → fresh install, apply everything in order.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Read all migrations from disk in numeric-prefix order.
 * Returns: [{ version, name, filename, sql }]
 */
function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .sort();

  return files.map(filename => {
    const m = filename.match(/^(\d+)_(.+)\.sql$/);
    return {
      version:  parseInt(m[1], 10),
      name:     m[2].replace(/_/g, ' '),
      filename,
      sql:      fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8'),
    };
  });
}

/**
 * Initialize the schema_migrations table if missing.
 * On legacy DBs (trades exists, no migrations table), prime the table
 * with every known migration marked as already-applied.
 */
function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Check if this is a legacy DB that pre-dates the migrator
  const tradesExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='trades'`
  ).get();
  const migrationCount = db.prepare(
    `SELECT COUNT(*) AS n FROM schema_migrations`
  ).get().n;

  if (tradesExists && migrationCount === 0) {
    // Legacy DB — baseline + all current migrations have already been
    // applied via the old safeAlter path. Prime the table so the
    // runner doesn't try to re-apply them.
    const knownMigrations = discoverMigrations();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`
    );
    const now = new Date().toISOString();
    for (const m of knownMigrations) {
      stmt.run(m.version, m.name, now);
    }
    if (knownMigrations.length > 0) {
      console.log(`[migrator] Legacy DB primed: ${knownMigrations.length} pre-existing migrations marked applied`);
    }
    return 'legacy-primed';
  }
  return tradesExists ? 'existing' : 'fresh';
}

/**
 * Apply all unapplied migrations in version order.
 */
export function runMigrations(db) {
  const initState = ensureMigrationTable(db);
  const applied = new Set(
    db.prepare(`SELECT version FROM schema_migrations`).all().map(r => r.version)
  );
  const all = discoverMigrations();
  const pending = all.filter(m => !applied.has(m.version));

  if (pending.length === 0) {
    if (initState === 'fresh') console.log('[migrator] Fresh DB, no migrations to apply (baseline schema only)');
    return { applied: 0, total: all.length };
  }

  console.log(`[migrator] Applying ${pending.length} pending migration(s)...`);
  const insertStmt = db.prepare(
    `INSERT INTO schema_migrations (version, name) VALUES (?, ?)`
  );

  for (const m of pending) {
    // Wrap each migration in a transaction — atomic apply
    const trx = db.transaction(() => {
      db.exec(m.sql);
      insertStmt.run(m.version, m.name);
    });
    try {
      trx();
      console.log(`[migrator] ✓ ${String(m.version).padStart(3, '0')} ${m.name}`);
    } catch (e) {
      console.error(`[migrator] ✗ ${m.filename} FAILED: ${e.message}`);
      throw new Error(`Migration ${m.filename} failed: ${e.message}`);
    }
  }

  return { applied: pending.length, total: all.length };
}

/**
 * Diagnostic: list all known migrations and their state.
 */
export function migrationStatus(db) {
  try {
    db.exec(`SELECT 1 FROM schema_migrations LIMIT 1`);
  } catch (_) {
    return { initialized: false, migrations: [] };
  }
  const applied = new Map(
    db.prepare(`SELECT version, applied_at FROM schema_migrations`).all().map(r => [r.version, r.applied_at])
  );
  const all = discoverMigrations();
  return {
    initialized: true,
    migrations: all.map(m => ({
      version:    m.version,
      name:       m.name,
      applied:    applied.has(m.version),
      applied_at: applied.get(m.version) || null,
    })),
  };
}

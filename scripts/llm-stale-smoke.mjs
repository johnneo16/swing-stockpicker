// Smoke test: fire jobStaleTradeReview manually. Confirms migration 006
// applied + LLM auth + stale candidates picked up + Telegram alert path.
// Safe to re-run — the job's 48h dedup window prevents duplicate reviews.
import 'dotenv/config';

if (process.env.LLM_ENABLED !== '1') {
  console.error('[smoke] LLM_ENABLED != 1 — set it before running');
  process.exit(2);
}

console.log('[smoke] importing db (triggers migration 006)...');
const { db } = await import('../src/persistence/db.js');
console.log('[smoke] applied migrations:',
  db.prepare(`SELECT version, name FROM schema_migrations`).all().map(r => `${r.version}=${r.name}`).join(', '));

console.log('[smoke] running jobStaleTradeReview...');
const { jobStaleTradeReview } = await import('../src/scheduler/jobs.js');
const result = await jobStaleTradeReview();
console.log('[smoke] job result:', JSON.stringify(result, null, 2));

const rows = db.prepare(`
  SELECT id, symbol, days_held, est_days, pnl_pct, recommendation,
         thesis_still_intact, suggested_stop, substr(rationale, 1, 140) as rationale_preview
  FROM stale_trade_reviews
  ORDER BY id DESC LIMIT 10
`).all();
console.log('[smoke] persisted reviews:', JSON.stringify(rows, null, 2));

// Backfill bull/bear/risk_verdict on currently-open positions.
// One-shot script: reads open trades, calls annotateTrade for each, persists.
// Safe to re-run — annotateTrade overwrites the three columns.
import 'dotenv/config';

if (process.env.LLM_ENABLED !== '1') {
  console.error('[backfill] LLM_ENABLED != 1 — set it before running');
  process.exit(2);
}

const { db } = await import('../src/persistence/db.js');
const { annotateTrade } = await import('../src/intelligence/bullBearAdvisor.js');

const open = db.prepare(`
  SELECT id, symbol, sector, setup_type, entry_price, initial_stop, target_price,
         current_stop, quantity, capital, risk_amount, confidence, rr_planned, est_days,
         metadata
  FROM trades WHERE status='open' AND mode='paper'
  ORDER BY entry_date ASC
`).all();

console.log(`[backfill] ${open.length} open positions to annotate`);
let ok = 0, fail = 0;

for (const t of open) {
  const meta = t.metadata ? JSON.parse(t.metadata) : {};
  const tradeData = {
    direction: 'LONG',
    symbol: t.symbol,
    sector: t.sector,
    setupType: t.setup_type,
    confidence: t.confidence,
    entryPrice: t.entry_price,
    stopLoss: t.current_stop ?? t.initial_stop,
    targetPrice: t.target_price,
    rrPlanned: t.rr_planned,
    estimatedDays: t.est_days,
    quantity: t.quantity,
    riskAmount: t.risk_amount,
    regime: meta.regime || null,
    earningsFlag: meta.earningsFlag || null,
  };
  process.stdout.write(`  ${t.symbol.padEnd(12)} (id=${t.id}) ... `);
  try {
    const r = await annotateTrade(t.id, tradeData);
    if (r?.bull && r?.bear) { ok++; console.log(`✓ bull=${(r.bull[0]||'').slice(0,40)}...`); }
    else { fail++; console.log('✗ no result'); }
  } catch (e) { fail++; console.log(`✗ ${e.message}`); }
}

console.log(`[backfill] done. ok=${ok} fail=${fail}`);
process.exit(fail === open.length && open.length > 0 ? 1 : 0);

/**
 * LLM-powered trade reflection — runs alongside the existing deterministic
 * tradeReflection.js. The deterministic version stays the primary; this
 * one ADDS a Sonnet-driven postmortem with deeper analysis.
 *
 * Adapted from ScalpLab (commit 696fabc).
 *
 * Persists to trades.llm_reflection_json (separate column from the
 * deterministic reflection_json — both coexist, never overwrite).
 *
 * Gated by LLM_ENABLED=1. Called from the trade-close hook AFTER the
 * deterministic reflection has already populated reflection_json.
 *
 * Cost: ~1 Sonnet call per closed trade. At swing rates (~50 trades/yr
 * on ₹50k pool) that's ~50 calls/yr = trivial against Pro subscription.
 */

import { llm } from './llm/client.js';
import { db } from '../persistence/db.js';

const SYSTEM_PROMPT = `You are a senior Indian swing trading coach reviewing a completed trade. Be brutally honest — the goal is to surface what could improve next time, not flatter the engine.

You're given the trade's open context (mechanical score, setup, indicators), the deterministic reflection (what the heuristic system saw), and the final outcome.

Identify:
1. Whether the setup was clean (high-quality setup well-executed) or marginal (engine reached for a thin signal).
2. The single most useful earlier-warning signal that, if monitored, could have predicted this outcome.
3. One concrete, actionable lesson — specific threshold or rule, not a platitude.

Return ONLY a JSON object:
{
  "setup_was_clean": true | false,
  "earlier_warning_signal": "specific signal name + threshold (e.g. 'RSI < 40 at day 3' or 'gap-up > 2% at entry')",
  "lessons": "one-sentence concrete action item for the engine or the human"
}

No markdown, no preamble. Pure JSON.`;

export async function reflectOnTradeLLM(trade) {
  if (!llm.isEnabled) return null;
  if (trade.status !== 'closed') return null;

  const userMessage = buildUserMessage(trade);
  let result;
  try {
    result = await llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      model: 'claude-sonnet-4-6',
      maxTokens: 800,
    });
  } catch (_) { return null; }
  if (!result?.text || result.disabled) return null;

  let parsed;
  try { parsed = JSON.parse(result.text); }
  catch (_) {
    const m = result.text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { parsed = JSON.parse(m[0]); } catch (_) { return null; }
  }

  try {
    db.prepare(`
      UPDATE trades
      SET llm_reflection_json = ?, llm_reflection_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(parsed), trade.id);
  } catch (_) { /* non-fatal */ }

  return parsed;
}

/**
 * Batch helper — walk yesterday's closures and reflect on any without
 * an LLM reflection yet. Idempotent.
 */
export async function reflectOnRecentClosures(limit = 20) {
  if (!llm.isEnabled) return { reflected: 0, skipped: 0 };
  const rows = db.prepare(`
    SELECT * FROM trades
    WHERE status = 'closed' AND llm_reflection_json IS NULL
    ORDER BY exit_date DESC LIMIT ?
  `).all(limit);

  let reflected = 0, skipped = 0;
  for (const t of rows) {
    const r = await reflectOnTradeLLM(t);
    if (r) reflected++; else skipped++;
  }
  return { reflected, skipped, total: rows.length };
}

function buildUserMessage(t) {
  const holdingDays = t.holding_days ?? 0;
  return [
    `Trade postmortem: ${t.symbol} ${t.direction || 'LONG'}`,
    ``,
    `Setup: ${t.setup_type ?? 'unknown'} · Sector: ${t.sector || 'unknown'}`,
    `Entry: ₹${t.entry_price} × ${t.quantity} qty · Initial stop: ₹${t.initial_stop} · Target: ₹${t.target_price}`,
    `Exit: ₹${t.exit_price} (reason: ${t.exit_reason || 'unknown'})`,
    `Held: ${holdingDays} days (planned ${t.est_days ?? '?'})`,
    `Outcome: gross ₹${t.realized_pnl} (${t.realized_pct?.toFixed?.(2) ?? '?'}%)`,
    `Confidence at entry: ${t.confidence ?? 'n/a'}`,
    `RR planned: ${t.rr_planned?.toFixed?.(2) ?? 'n/a'}`,
    ``,
    `Bull case at entry: ${t.bull_argument ?? 'not annotated'}`,
    `Bear case at entry: ${t.bear_argument ?? 'not annotated'}`,
    ``,
    `Deterministic reflection (heuristics):`,
    `  ${t.reflection_json ?? '(none)'}`,
    ``,
    `Produce the postmortem JSON.`,
  ].join('\n');
}

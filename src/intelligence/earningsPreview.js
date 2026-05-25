/**
 * Earnings preview — auto-runs on open positions within N days of an
 * earnings event. Returns an action recommendation (HOLD / TRIM_50 / EXIT)
 * + rationale, persisted to earnings_previews.
 *
 * Prompt pattern adapted from the equity-research plugin's earnings-preview
 * SKILL.md (institutional analyst preview note) to retail Indian swing
 * trading context:
 *   - Output is JSON with explicit action, not a prose note
 *   - Considers current PnL + days held (position-relative risk)
 *   - Skips consensus tables (no buy-side surveys for NSE retail)
 *   - Focuses on implied volatility expectation + post-earnings drift risk
 *
 * Gated by LLM_ENABLED=1. Fire-and-forget — never blocks trades.
 * Caller (job) is responsible for deciding when to invoke + alerting.
 */

import { llm } from './llm/client.js';
import { db } from '../persistence/db.js';

const SYSTEM_PROMPT = `You are an Indian retail swing trading advisor. A position is approaching its earnings date. The trade is already open — your job is to recommend whether to HOLD through earnings, TRIM 50%, or EXIT entirely BEFORE the print.

Indian retail context (different from institutional):
- No buy-side whisper numbers available
- Post-earnings gaps can be ±5–15% on midcap names
- Implied move from options is often the best market-expectation proxy
- Earnings blackout already enforces 2-day pre-event entry block; this advisor is for positions opened BEFORE the blackout window
- Holding through earnings is binary: small win on beat, large loss on miss. Asymmetric for already-profitable trades; symmetric for break-even

Output ONLY a JSON object — no markdown, no preamble:
{
  "recommendation": "HOLD" | "TRIM_50" | "EXIT",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "rationale": "2-3 sentence reasoning",
  "key_risks": ["risk 1", "risk 2", "risk 3"]
}

Heuristics:
- Already +5% or more and within 2 days of earnings → strong case for TRIM_50 (lock half, ride other half)
- Already -3% or worse and within 3 days of earnings → strong case for EXIT (don't let earnings be the rescue trade)
- Within 1 day and at break-even → consider TRIM_50 if R:R remaining < 1.5
- HOLD only if thesis is intact, current PnL is positive, and you'd open the trade again today`;

function buildUserMessage(t) {
  const lines = [
    `Position: ${t.direction || 'LONG'} ${t.symbol}`,
    `Sector: ${t.sector || 'unknown'}`,
    `Entry: ₹${t.entryPrice}  ·  Current: ₹${t.currentPrice ?? '?'}  ·  PnL: ${t.currentPnlPct?.toFixed(2)}%`,
    `Stop: ₹${t.stopLoss}  ·  Target: ₹${t.targetPrice}  ·  Planned R:R: ${t.rrPlanned ?? '?'}`,
    `Days held: ${t.daysHeld} (est. ${t.estimatedDays})`,
    `Setup: ${t.setupType || 'unknown'}  ·  Original confidence: ${t.confidence ?? '?'}/100`,
    ``,
    `Upcoming earnings: ${t.earningsDate} (${t.daysToEarnings} day${t.daysToEarnings === 1 ? '' : 's'} away)`,
    t.regime ? `Market regime: ${t.regime}` : '',
    ``,
    t.bullArgument ? `Existing bull case from open-time advisor:\n${t.bullArgument}\n` : '',
    t.bearArgument ? `Existing bear case from open-time advisor:\n${t.bearArgument}\n` : '',
    ``,
    `Produce the JSON recommendation.`,
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Run an earnings preview for one open trade.
 * Returns the parsed result + persisted row id, or null on failure.
 *
 * @param {object} tradeCtx — see buildUserMessage for shape
 * @returns {Promise<{id, recommendation, confidence, rationale, key_risks}|null>}
 */
export async function runEarningsPreview(tradeCtx) {
  if (!llm.isEnabled) return null;
  if (!tradeCtx.tradeId || !tradeCtx.symbol || !tradeCtx.earningsDate) return null;

  let result;
  try {
    result = await llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(tradeCtx) }],
      model: 'claude-sonnet-4-5',  // Sonnet — this is a deeper analytical call
      maxTokens: 700,
    });
  } catch (_) { return null; }
  if (!result?.text || result.disabled) return null;

  const parsed = extractJson(result.text);
  if (!parsed?.recommendation) return null;

  let rowId;
  try {
    rowId = db.prepare(`
      INSERT INTO earnings_previews
        (trade_id, symbol, earnings_date, days_to_earnings, current_pnl_pct,
         recommendation, confidence_level, rationale, key_risks_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tradeCtx.tradeId,
      tradeCtx.symbol,
      tradeCtx.earningsDate,
      tradeCtx.daysToEarnings,
      tradeCtx.currentPnlPct ?? null,
      String(parsed.recommendation).toUpperCase(),
      String(parsed.confidence || 'MEDIUM').toUpperCase(),
      String(parsed.rationale || ''),
      JSON.stringify(Array.isArray(parsed.key_risks) ? parsed.key_risks : []),
    ).lastInsertRowid;
  } catch (_) { return null; }

  return { id: rowId, ...parsed };
}

function extractJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

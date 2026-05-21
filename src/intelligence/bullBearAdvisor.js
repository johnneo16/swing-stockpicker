/**
 * Bull/Bear pre-trade advisor — async LLM annotation on every approved
 * swing trade.
 *
 * Adapted from ScalpLab (commit 696fabc) for SwingPro's daily-bar context:
 *   - Holding days, not minutes
 *   - Setup categories from scoringEngine
 *   - Stop/target in absolute ₹, not ATR multiples
 *
 * NOT a trade gate. Mechanical engine has already approved this trade.
 * This runs *after* trade entry, generates bull + bear arguments, and
 * persists them to trades.bull_argument / .bear_argument / .risk_verdict.
 *
 * Graceful degradation: any LLM failure (quota, auth, timeout) → silent
 * skip. Trade is unaffected. Existing deterministic reflection still runs.
 *
 * Gated by LLM_ENABLED=1.
 */

import { llm } from './llm/client.js';
import { db } from '../persistence/db.js';

const SYSTEM_PROMPT = `You are an Indian swing trading advisor evaluating a position that's just been opened by a mechanical scoring engine. The trade is already placed — your job is postmortem context, not approval.

Produce a SHORT bull case (3 bullets max), a SHORT bear case (3 bullets max), and a one-line risk verdict. Be specific and use the data provided. Don't sugarcoat — name the real risks.

Return ONLY a JSON object in this exact shape:
{
  "bull": ["bullet 1", "bullet 2", "bullet 3"],
  "bear": ["bullet 1", "bullet 2", "bullet 3"],
  "risk_verdict": "one-sentence summary of the most material risk to this trade"
}

No markdown, no preamble. Pure JSON.`;

export async function annotateTrade(tradeId, tradeData) {
  if (!llm.isEnabled) return null;

  const userMessage = buildUserMessage(tradeData);
  let result;
  try {
    result = await llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      model: 'claude-haiku-4-5',
      maxTokens: 600,
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
      UPDATE trades SET bull_argument = ?, bear_argument = ?, risk_verdict = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      Array.isArray(parsed.bull) ? parsed.bull.join('\n• ') : String(parsed.bull || ''),
      Array.isArray(parsed.bear) ? parsed.bear.join('\n• ') : String(parsed.bear || ''),
      String(parsed.risk_verdict || ''),
      tradeId,
    );
  } catch (_) { /* persist failure is non-fatal */ }

  return parsed;
}

function buildUserMessage(t) {
  return [
    `New ${t.direction || 'LONG'} swing trade opened by mechanical engine.`,
    ``,
    `Symbol: ${t.symbol} · Sector: ${t.sector || 'unknown'}`,
    `Setup: ${t.setupType || 'unknown'}  · Confidence: ${t.confidence ?? 'n/a'}/100`,
    `Entry: ₹${t.entryPrice} · Stop: ₹${t.stopLoss} · Target: ₹${t.targetPrice}`,
    `Planned R:R = ${t.rrPlanned?.toFixed?.(2) ?? 'n/a'} · Est days = ${t.estimatedDays ?? 'n/a'}`,
    `Qty: ${t.quantity} · Capital: ₹${(t.quantity * t.entryPrice).toFixed(0)} · Risk: ₹${t.riskAmount}`,
    t.regime ? `Market regime: ${t.regime}` : '',
    t.earningsFlag ? `Earnings flag: ${t.earningsFlag}` : '',
    ``,
    `Produce the bull/bear/risk JSON.`,
  ].filter(Boolean).join('\n');
}

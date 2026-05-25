/**
 * Stale trade review — when a position has been held >1.5x its estimated
 * days AND is at a loss, run an LLM thesis review and recommend
 * CONTINUE_HOLD / TIGHTEN_STOP / EXIT.
 *
 * Prompt pattern adapted from the equity-research plugin's thesis-tracker
 * SKILL.md (institutional analyst thesis-update flow) to retail Indian
 * swing trading context:
 *   - One-shot reassessment (not a running scorecard) — the user is
 *     trading dozens of positions over months, not 5 positions over years
 *   - Inputs include the original bull/bear cases from the open-time
 *     advisor (already in trades.bull_argument / .bear_argument)
 *   - Output is an explicit action, not a "review note"
 *   - Specifically asks whether the original thesis pillars are still
 *     intact OR whether the trade has drifted into "hope mode"
 *
 * The trigger conditions (1.5x est_days + losing) target the specific
 * failure mode seen on ONGC: opened at conviction 53, held 20 days vs
 * 12 estimated, sitting at -2.7% — classic "should have exited" trade
 * that mechanical exit rules don't catch quickly enough.
 *
 * Gated by LLM_ENABLED=1. Fire-and-forget — never blocks.
 */

import { llm } from './llm/client.js';
import { db } from '../persistence/db.js';

const SYSTEM_PROMPT = `You are an Indian retail swing trading advisor reviewing a position that has gone "stale" — held significantly longer than its estimated holding period AND currently at a loss. The mechanical stop has not triggered yet, but the trade has clearly drifted from its original setup window.

Your job: decide whether to CONTINUE_HOLD (thesis intact, just slow), TIGHTEN_STOP (cut downside but allow recovery), or EXIT (cut now and free the capital).

Critical heuristics for "hope mode" detection:
- Original thesis pillars still confirmable in current price action? (e.g., "uptrend" claim still true?)
- Has the catalyst that was supposed to drive the move already played out?
- Is the user holding because of conviction or because they don't want to realize the loss?
- Capital opportunity cost: ₹X tied up here is ₹X NOT in a fresh setup

Decision framework:
- CONTINUE_HOLD: original thesis pillars still hold + price structure constructive + recent action sideways (not making lower lows). RARE for trades >1.5x est_days at a loss; bias against this.
- TIGHTEN_STOP: trade is salvageable but needs a tighter risk leash. Specify a new stop level closer to current price.
- EXIT: original thesis pillars broken OR price making lower lows OR capital better deployed elsewhere. DEFAULT recommendation for trades both stale AND losing — the math is brutal: held this long with no payoff means low probability of one.

Output ONLY a JSON object — no markdown, no preamble:
{
  "recommendation": "CONTINUE_HOLD" | "TIGHTEN_STOP" | "EXIT",
  "thesis_still_intact": true | false,
  "pillars_status": {"pillar 1": "intact|weakened|broken", ...},
  "rationale": "2-3 sentence reasoning, name the specific failure mode if EXIT",
  "suggested_stop": null | <new stop price as number>
}

If recommendation is TIGHTEN_STOP, suggested_stop is REQUIRED. Otherwise null.`;

function buildUserMessage(t) {
  const lines = [
    `Stale position review: ${t.symbol}`,
    `Sector: ${t.sector || 'unknown'}  ·  Setup: ${t.setupType || 'unknown'}  ·  Original confidence: ${t.confidence ?? '?'}/100`,
    ``,
    `Entry: ₹${t.entryPrice}  ·  Current: ₹${t.currentPrice ?? '?'}  ·  PnL: ${t.currentPnlPct?.toFixed(2)}%`,
    `Stop: ₹${t.stopLoss}  ·  Target: ₹${t.targetPrice}  ·  Planned R:R: ${t.rrPlanned ?? '?'}`,
    `Days held: ${t.daysHeld} (est. ${t.estimatedDays} — ${(t.daysHeld / Math.max(t.estimatedDays, 1)).toFixed(1)}× over)`,
    t.regime ? `Current market regime: ${t.regime}` : '',
    ``,
    t.bullArgument ? `Original bull case (at entry):\n${t.bullArgument}\n` : '',
    t.bearArgument ? `Original bear case (at entry):\n${t.bearArgument}\n` : '',
    t.riskVerdict ? `Original risk verdict: ${t.riskVerdict}\n` : '',
    ``,
    `Produce the JSON recommendation. Be honest — the user wants to know if they're in hope mode.`,
  ].filter(Boolean);
  return lines.join('\n');
}

export async function runStaleTradeReview(tradeCtx) {
  if (!llm.isEnabled) return null;
  if (!tradeCtx.tradeId || !tradeCtx.symbol) return null;

  let result;
  try {
    result = await llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(tradeCtx) }],
      model: 'claude-sonnet-4-5',
      maxTokens: 800,
    });
  } catch (_) { return null; }
  if (!result?.text || result.disabled) return null;

  const parsed = extractJson(result.text);
  if (!parsed?.recommendation) return null;

  let rowId;
  try {
    rowId = db.prepare(`
      INSERT INTO stale_trade_reviews
        (trade_id, symbol, days_held, est_days, pnl_pct,
         recommendation, thesis_still_intact, pillars_status_json, rationale, suggested_stop)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tradeCtx.tradeId,
      tradeCtx.symbol,
      tradeCtx.daysHeld,
      tradeCtx.estimatedDays ?? null,
      tradeCtx.currentPnlPct ?? 0,
      String(parsed.recommendation).toUpperCase(),
      parsed.thesis_still_intact ? 1 : 0,
      JSON.stringify(parsed.pillars_status || {}),
      String(parsed.rationale || ''),
      typeof parsed.suggested_stop === 'number' ? parsed.suggested_stop : null,
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

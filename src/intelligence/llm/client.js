/**
 * LLM client facade — ported from ScalpLab (commit 696fabc).
 *
 * Hard rule: this module is NO-OP when LLM_ENABLED !== '1'. The reflection
 * + bull/bear advisor wrappers also short-circuit on the same flag.
 * Goal: zero behavioral change to SwingPro unless explicitly enabled.
 *
 *   LLM_BACKEND=agent-sdk  → Claude Code subscription auth (local Mac, default)
 *   LLM_BACKEND=api        → ANTHROPIC_API_KEY (cloud or fallback)
 *   LLM_ENABLED=0/1        → master gate; OFF by default
 *
 * Public interface:
 *   await llm.complete({ system, messages, model, maxTokens }) → { text, usage }
 *   await llm.health()
 *   llm.isEnabled
 */

import { agentSdkAdapter } from './adapters/agentSdk.js';
import { apiKeyAdapter } from './adapters/apiKey.js';

const ENABLED = process.env.LLM_ENABLED === '1';
const BACKEND = (process.env.LLM_BACKEND || 'agent-sdk').toLowerCase();

const primary  = BACKEND === 'api' ? apiKeyAdapter : agentSdkAdapter;
const fallback = BACKEND === 'api' ? agentSdkAdapter : apiKeyAdapter;

const DISABLED_RESULT = {
  text: '',
  usage: { input_tokens: 0, output_tokens: 0 },
  disabled: true,
};

export const llm = {
  backend: BACKEND,
  isEnabled: ENABLED,

  async complete(opts) {
    if (!ENABLED) return DISABLED_RESULT;
    const start = Date.now();
    try {
      const result = await primary.complete(opts);
      return result;
    } catch (e) {
      // Soft fallback: subscription → API if API key is set
      if (process.env.ANTHROPIC_API_KEY && BACKEND !== 'api') {
        try {
          const result = await fallback.complete(opts);
          return { ...result, fallbackUsed: true };
        } catch (_) {}
      }
      throw e;
    }
  },

  async health() {
    if (!ENABLED) return { ok: true, backend: BACKEND, enabled: false, note: 'LLM gated off — set LLM_ENABLED=1 to use' };
    return primary.health();
  },
};

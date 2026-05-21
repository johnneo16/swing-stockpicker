/**
 * Anthropic API-key adapter — uses ANTHROPIC_API_KEY for paid billing.
 *
 * Fallback path if subscription auth fails. Lifted from ScalpLab.
 */

import Anthropic from '@anthropic-ai/sdk';

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const DEFAULT_MODEL = 'claude-haiku-4-5';

export const apiKeyAdapter = {
  async complete({ system, messages = [], model = DEFAULT_MODEL, maxTokens = 1024 } = {}) {
    const c = getClient();
    const result = await c.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    const text = (result.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    return {
      text: text.trim(),
      usage: { input_tokens: result.usage?.input_tokens || 0, output_tokens: result.usage?.output_tokens || 0 },
      model,
      stopReason: result.stop_reason,
    };
  },

  async health() {
    try {
      const r = await this.complete({
        system: 'Reply with exactly the word OK and nothing else.',
        messages: [{ role: 'user', content: 'ping' }],
        model: 'claude-haiku-4-5',
        maxTokens: 10,
      });
      return { ok: r.text.toUpperCase().includes('OK'), backend: 'api', sample: r.text.slice(0, 40), usage: r.usage };
    } catch (e) {
      return { ok: false, backend: 'api', error: e.message, hasKey: Boolean(process.env.ANTHROPIC_API_KEY) };
    }
  },
};

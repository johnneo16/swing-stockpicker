/**
 * Claude Agent SDK adapter — uses Claude Code's subscription auth (Pro/Max).
 *
 * Free to call while running on the user's Mac since the Pro plan covers
 * usage. Token expires every ~30 days — user must run `claude /login` to
 * refresh, after which subprocess calls (like this one) pick up the fresh
 * keychain token automatically.
 *
 * Lifted verbatim from ScalpLab — same SDK, same usage shape.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

const DEFAULT_MODEL = 'claude-haiku-4-5';

export const agentSdkAdapter = {
  async complete({ system, messages = [], model = DEFAULT_MODEL, maxTokens = 1024 } = {}) {
    const userText = messages
      .filter(m => m.role === 'user')
      .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n\n');

    if (!userText) throw new Error('agentSdkAdapter.complete: empty user message');

    const options = {
      model,
      maxTurns: 1,
      systemPrompt: system,
      allowedTools: [],
      permissionMode: 'bypassPermissions',
    };

    let text = '';
    let inputTokens = 0, outputTokens = 0, stopReason = null;

    const iterator = query({ prompt: userText, options });
    for await (const msg of iterator) {
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) text += block.text;
        }
      } else if (msg.type === 'result') {
        if (msg.usage) {
          inputTokens  = msg.usage.input_tokens  || 0;
          outputTokens = msg.usage.output_tokens || 0;
        }
        stopReason = msg.subtype || null;
        break;
      } else if (msg.type === 'system' && msg.subtype === 'error') {
        throw new Error(`Agent SDK error: ${msg.message || 'unknown'}`);
      }
    }

    return {
      text: text.trim(),
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      model,
      stopReason,
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
      return { ok: r.text.toUpperCase().includes('OK'), backend: 'agent-sdk', sample: r.text.slice(0, 40), usage: r.usage };
    } catch (e) {
      return { ok: false, backend: 'agent-sdk', error: e.message };
    }
  },
};

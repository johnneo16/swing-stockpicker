// Quick LLM smoke test. Force-enables LLM and runs health + one prompt.
process.env.LLM_ENABLED = '1';
process.env.LLM_BACKEND = process.env.LLM_BACKEND || 'agent-sdk';
const { llm } = await import('../src/intelligence/llm/client.js');
console.log('isEnabled:', llm.isEnabled, 'backend:', llm.backend);
const health = await llm.health();
console.log('health:', JSON.stringify(health, null, 2));
if (!health.ok) process.exit(1);
const r = await llm.complete({
  system: 'You are a terse assistant. Reply in <10 words.',
  messages: [{ role: 'user', content: 'Say "smoke test passing" exactly.' }],
  model: 'claude-haiku-4-5',
  maxTokens: 50,
});
console.log('complete:', JSON.stringify({ text: r.text, usage: r.usage }, null, 2));

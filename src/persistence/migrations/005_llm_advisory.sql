-- LLM advisory columns. All nullable, fully optional — populated only
-- when LLM_ENABLED=1. Existing deterministic reflection_json untouched.

ALTER TABLE trades ADD COLUMN bull_argument TEXT;
ALTER TABLE trades ADD COLUMN bear_argument TEXT;
ALTER TABLE trades ADD COLUMN risk_verdict TEXT;
ALTER TABLE trades ADD COLUMN llm_reflection_json TEXT;
ALTER TABLE trades ADD COLUMN llm_reflection_at TEXT;

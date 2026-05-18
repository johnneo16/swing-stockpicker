-- 002: Deterministic post-trade reflection columns on trades table.
-- reflection_json stores the heuristic-generated reflection (whatWorked,
-- whatDidnt, lesson, setupRating, wouldRetake, tags, rMultiple, targetR).
-- reflection_at is the ISO timestamp it was generated.

ALTER TABLE trades ADD COLUMN reflection_json TEXT;
ALTER TABLE trades ADD COLUMN reflection_at TEXT;

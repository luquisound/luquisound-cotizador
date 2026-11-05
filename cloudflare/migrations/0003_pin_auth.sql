CREATE TABLE quotation_pin_limits (
  slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 0 AND 128),
  window_start INTEGER NOT NULL CHECK (window_start >= 0 AND window_start % 900 = 0),
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND CASE WHEN slot = 0 THEN 50 ELSE 5 END),
  permit_token TEXT CHECK (permit_token IS NULL OR (slot = 0 AND length(permit_token) = 22))
);

WITH RECURSIVE slots(slot) AS (
  SELECT 0
  UNION ALL
  SELECT slot + 1 FROM slots WHERE slot < 128
)
INSERT INTO quotation_pin_limits (slot, window_start, attempts, permit_token)
SELECT slot, 0, 0, NULL FROM slots;

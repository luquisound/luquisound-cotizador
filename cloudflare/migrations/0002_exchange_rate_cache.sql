CREATE TABLE exchange_rate_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  quote_json TEXT NOT NULL CHECK (length(CAST(quote_json AS BLOB)) <= 8192 AND json_valid(quote_json))
);

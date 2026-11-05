CREATE TABLE quotation_board_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  epoch TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0 AND revision <= 9007199254740991),
  entry_count INTEGER NOT NULL CHECK (entry_count BETWEEN 0 AND 100),
  category_count INTEGER NOT NULL CHECK (category_count BETWEEN 0 AND 100),
  entry_bytes INTEGER NOT NULL CHECK (entry_bytes >= 0),
  category_bytes INTEGER NOT NULL CHECK (category_bytes >= 0),
  write_token TEXT NOT NULL,
  CHECK (entry_bytes + category_bytes <= 5242880)
);

INSERT INTO quotation_board_meta VALUES (1, 'initial', 0, 0, 0, 0, 0, 'initial');

CREATE TABLE quotation_board_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  json_bytes INTEGER NOT NULL CHECK (json_bytes > 0)
);

CREATE TABLE quotation_board_entries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES quotation_board_categories(id),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  updated_at TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  pending INTEGER NOT NULL CHECK (pending IN (0, 1)),
  last_operation_id TEXT NOT NULL UNIQUE,
  last_operation_hash TEXT NOT NULL,
  entry_json TEXT NOT NULL CHECK (json_valid(entry_json)),
  json_bytes INTEGER NOT NULL CHECK (json_bytes BETWEEN 1 AND 262144),
  CHECK (length(CAST(entry_json AS BLOB)) = json_bytes)
);

CREATE INDEX quotation_board_entries_updated ON quotation_board_entries(updated_at DESC, id);

CREATE TABLE quotation_board_versions (
  version_id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_epoch TEXT NOT NULL,
  board_revision INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  entry_revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND length(CAST(snapshot_json AS BLOB)) <= 262144),
  category_json TEXT,
  archived_at TEXT NOT NULL
);

CREATE TRIGGER quotation_board_versions_bounded
AFTER INSERT ON quotation_board_versions
BEGIN
  DELETE FROM quotation_board_versions
  WHERE version_id NOT IN (
    SELECT version_id FROM quotation_board_versions ORDER BY version_id DESC LIMIT 50
  );
END;

CREATE TABLE playback_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  snapshot_revision INTEGER NOT NULL CHECK (snapshot_revision >= 0),
  snapshot_json TEXT NOT NULL CHECK (
    length(snapshot_json) > 1
    AND length(snapshot_json) <= 4194304
  ),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

CREATE TABLE smart_playlist_rules (
  playlist_id TEXT PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version = 1),
  rule_json TEXT NOT NULL
    CHECK (LENGTH(rule_json) BETWEEN 2 AND 65536),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_smart_playlist_rules_updated
  ON smart_playlist_rules (updated_at DESC, playlist_id);

CREATE TRIGGER smart_playlist_rules_require_smart_owner
BEFORE INSERT ON smart_playlist_rules
WHEN NOT EXISTS (
  SELECT 1 FROM playlists
  WHERE playlists.id = NEW.playlist_id AND playlists.kind = 'smart'
)
BEGIN
  SELECT RAISE(ABORT, 'smart playlist rules require a smart playlist');
END;

CREATE TRIGGER smart_playlist_rules_keep_smart_owner
BEFORE UPDATE OF playlist_id ON smart_playlist_rules
WHEN NOT EXISTS (
  SELECT 1 FROM playlists
  WHERE playlists.id = NEW.playlist_id AND playlists.kind = 'smart'
)
BEGIN
  SELECT RAISE(ABORT, 'smart playlist rules require a smart playlist');
END;

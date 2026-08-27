CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
    CHECK (name = TRIM(name) AND LENGTH(name) BETWEEN 1 AND 200),
  name_key TEXT NOT NULL UNIQUE
    CHECK (LENGTH(name_key) BETWEEN 1 AND 400),
  kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('manual', 'smart')),
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_playlists_updated
  ON playlists (updated_at DESC, name COLLATE NOCASE, id);

CREATE TABLE playlist_entries (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  title_snapshot TEXT NOT NULL CHECK (LENGTH(title_snapshot) <= 1024),
  artist_snapshot TEXT NOT NULL CHECK (LENGTH(artist_snapshot) <= 1024),
  album_snapshot TEXT NOT NULL CHECK (LENGTH(album_snapshot) <= 1024),
  added_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (playlist_id, position)
);

CREATE INDEX idx_playlist_entries_order
  ON playlist_entries (playlist_id, position, id);
CREATE INDEX idx_playlist_entries_song
  ON playlist_entries (song_id);

CREATE TABLE play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL CHECK (LENGTH(track_id) BETWEEN 1 AND 128),
  title_snapshot TEXT NOT NULL CHECK (LENGTH(title_snapshot) <= 1024),
  artist_snapshot TEXT NOT NULL CHECK (LENGTH(artist_snapshot) <= 1024),
  album_snapshot TEXT NOT NULL CHECK (LENGTH(album_snapshot) <= 1024),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('context', 'queue')),
  started_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
  listened_ms INTEGER NOT NULL DEFAULT 0 CHECK (listened_ms >= 0),
  position_ms INTEGER NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  open_slot INTEGER UNIQUE DEFAULT 1 CHECK (open_slot IS NULL OR open_slot = 1),
  CHECK (
    (ended_at IS NULL AND open_slot = 1 AND completed = 0)
    OR (ended_at IS NOT NULL AND open_slot IS NULL)
  )
);

CREATE INDEX idx_play_history_started
  ON play_history (started_at DESC, id DESC);
CREATE INDEX idx_play_history_track
  ON play_history (track_id, started_at DESC, id DESC);

CREATE TABLE library_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  canonical_path TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  watch_status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (watch_status IN ('inactive', 'starting', 'watching', 'degraded', 'unavailable')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_scan_at TEXT
);

CREATE TABLE library_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE RESTRICT,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'cancelled', 'failed', 'interrupted')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  discovered INTEGER NOT NULL DEFAULT 0 CHECK (discovered >= 0),
  updated INTEGER NOT NULL DEFAULT 0 CHECK (updated >= 0),
  unavailable INTEGER NOT NULL DEFAULT 0 CHECK (unavailable >= 0),
  failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  error_summary TEXT
);

ALTER TABLE songs ADD COLUMN root_id INTEGER REFERENCES library_roots(id) ON DELETE SET NULL;
ALTER TABLE songs ADD COLUMN normalized_path TEXT;
ALTER TABLE songs ADD COLUMN file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0);
ALTER TABLE songs ADD COLUMN modified_at_ns INTEGER CHECK (modified_at_ns IS NULL OR modified_at_ns >= 0);
ALTER TABLE songs ADD COLUMN quick_fingerprint TEXT;
ALTER TABLE songs ADD COLUMN availability TEXT NOT NULL DEFAULT 'available'
  CHECK (availability IN ('available', 'unavailable'));
ALTER TABLE songs ADD COLUMN last_seen_scan_id INTEGER REFERENCES library_scans(id) ON DELETE SET NULL;
ALTER TABLE songs ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 1 CHECK (metadata_version >= 1);

CREATE INDEX idx_library_scans_root_started ON library_scans (root_id, started_at DESC);
CREATE UNIQUE INDEX idx_songs_root_normalized_path ON songs (root_id, normalized_path)
  WHERE root_id IS NOT NULL AND normalized_path IS NOT NULL;
CREATE INDEX idx_songs_root_availability ON songs (root_id, availability, normalized_path);
CREATE INDEX idx_songs_last_seen_scan ON songs (last_seen_scan_id);

DROP TRIGGER songs_catalog_revision_update;
CREATE TRIGGER songs_catalog_revision_update
AFTER UPDATE OF
  id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
  trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
  favorRating, dateAdded, visualsPath, availability
ON songs
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE id = 1;
END;

DROP TRIGGER songs_fts_update;
CREATE TRIGGER songs_fts_update
AFTER UPDATE OF id, title, artist, album, file ON songs
BEGIN
  DELETE FROM songs_fts WHERE song_id = old.id;
  INSERT INTO songs_fts (song_id, title, artist, album, file)
  VALUES (new.id, new.title, new.artist, new.album, new.file);
END;

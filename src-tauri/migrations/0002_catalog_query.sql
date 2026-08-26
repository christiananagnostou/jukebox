CREATE INDEX IF NOT EXISTS idx_songs_default_browse
  ON songs (artist COLLATE NOCASE, album COLLATE NOCASE, side, trackNumber, title COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS idx_songs_title_browse ON songs (title COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS idx_songs_artist_browse
  ON songs (artist COLLATE NOCASE, album COLLATE NOCASE, trackNumber, id);
CREATE INDEX IF NOT EXISTS idx_songs_album_browse
  ON songs (album COLLATE NOCASE, artist COLLATE NOCASE, trackNumber, id);
CREATE INDEX IF NOT EXISTS idx_songs_track_browse ON songs (trackNumber, title COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS idx_songs_sample_rate_browse ON songs (CAST(sampleRate AS INTEGER), id);
CREATE INDEX IF NOT EXISTS idx_songs_date_browse ON songs (CAST(date AS INTEGER), id);
CREATE INDEX IF NOT EXISTS idx_songs_date_added_browse ON songs (dateAdded, id);
CREATE INDEX IF NOT EXISTS idx_songs_favorite_browse ON songs (favorRating, id);

CREATE TABLE IF NOT EXISTS catalog_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
INSERT INTO catalog_meta (id, revision) VALUES (1, 0)
  ON CONFLICT(id) DO NOTHING;

CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
  song_id UNINDEXED,
  title,
  artist,
  album,
  file,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO songs_fts (song_id, title, artist, album, file)
SELECT songs.id, songs.title, songs.artist, songs.album, songs.file
FROM songs
WHERE NOT EXISTS (SELECT 1 FROM songs_fts WHERE songs_fts.song_id = songs.id);

CREATE TRIGGER IF NOT EXISTS songs_catalog_revision_insert
AFTER INSERT ON songs
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS songs_catalog_revision_update
AFTER UPDATE ON songs
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS songs_catalog_revision_delete
AFTER DELETE ON songs
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS songs_fts_insert
AFTER INSERT ON songs
BEGIN
  INSERT INTO songs_fts (song_id, title, artist, album, file)
  VALUES (new.id, new.title, new.artist, new.album, new.file);
END;

CREATE TRIGGER IF NOT EXISTS songs_fts_update
AFTER UPDATE ON songs
BEGIN
  DELETE FROM songs_fts WHERE song_id = old.id;
  INSERT INTO songs_fts (song_id, title, artist, album, file)
  VALUES (new.id, new.title, new.artist, new.album, new.file);
END;

CREATE TRIGGER IF NOT EXISTS songs_fts_delete
AFTER DELETE ON songs
BEGIN
  DELETE FROM songs_fts WHERE song_id = old.id;
END;

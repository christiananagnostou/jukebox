DROP TRIGGER IF EXISTS songs_fts_insert;
DROP TRIGGER IF EXISTS songs_fts_update;
DROP TRIGGER IF EXISTS songs_fts_delete;
DROP TABLE IF EXISTS songs_fts;

CREATE VIRTUAL TABLE songs_fts USING fts5(
  song_id UNINDEXED,
  title,
  artist,
  album,
  genre,
  file,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO songs_fts (song_id, title, artist, album, genre, file)
SELECT id, title, artist, album, genre, file
FROM songs;

CREATE TRIGGER songs_fts_insert
AFTER INSERT ON songs
BEGIN
  INSERT INTO songs_fts (song_id, title, artist, album, genre, file)
  VALUES (new.id, new.title, new.artist, new.album, new.genre, new.file);
END;

CREATE TRIGGER songs_fts_update
AFTER UPDATE OF id, title, artist, album, genre, file ON songs
BEGIN
  DELETE FROM songs_fts WHERE song_id = old.id;
  INSERT INTO songs_fts (song_id, title, artist, album, genre, file)
  VALUES (new.id, new.title, new.artist, new.album, new.genre, new.file);
END;

CREATE TRIGGER songs_fts_delete
AFTER DELETE ON songs
BEGIN
  DELETE FROM songs_fts WHERE song_id = old.id;
END;

CREATE INDEX idx_songs_genre_filter ON songs (genre COLLATE NOCASE, id);
CREATE INDEX idx_songs_codec_filter ON songs (codec COLLATE NOCASE, id);
CREATE INDEX idx_songs_year_filter ON songs (CAST(date AS INTEGER), id);
CREATE INDEX idx_songs_availability_filter ON songs (availability, id);

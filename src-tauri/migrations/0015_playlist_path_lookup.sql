CREATE INDEX idx_songs_path_lookup
  ON songs (path, availability, id);

CREATE INDEX idx_songs_path_lookup_nocase
  ON songs (path COLLATE NOCASE, availability, id);

ALTER TABLE library_scan_metadata
  ADD COLUMN matched_song_id TEXT REFERENCES songs(id) ON DELETE SET NULL;

CREATE INDEX idx_songs_root_fingerprint
  ON songs (root_id, file_size, quick_fingerprint)
  WHERE root_id IS NOT NULL AND file_size IS NOT NULL AND quick_fingerprint IS NOT NULL;

CREATE INDEX idx_library_scan_files_size
  ON library_scan_files (scan_id, file_size, normalized_path);

CREATE TABLE library_scan_files (
  scan_id INTEGER NOT NULL REFERENCES library_scans(id) ON DELETE CASCADE,
  normalized_path TEXT NOT NULL CHECK (length(normalized_path) > 0),
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  modified_at_ns INTEGER NOT NULL CHECK (modified_at_ns >= 0),
  PRIMARY KEY (scan_id, normalized_path)
) WITHOUT ROWID;

CREATE UNIQUE INDEX idx_library_scans_one_active_root
  ON library_scans (root_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX idx_library_scans_status_started
  ON library_scans (status, started_at);

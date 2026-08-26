CREATE TABLE library_reconciliations (
  scan_id INTEGER PRIMARY KEY REFERENCES library_scans(id) ON DELETE CASCADE,
  root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE RESTRICT,
  status TEXT NOT NULL
    CHECK (status IN (
      'pending', 'preparing', 'ready', 'applying', 'completed',
      'cancelled', 'failed', 'interrupted'
    )),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  processed INTEGER NOT NULL DEFAULT 0 CHECK (processed >= 0 AND processed <= total),
  changed INTEGER NOT NULL DEFAULT 0 CHECK (changed >= 0 AND changed <= processed),
  unchanged INTEGER NOT NULL DEFAULT 0 CHECK (unchanged >= 0 AND unchanged <= processed),
  renamed INTEGER NOT NULL DEFAULT 0 CHECK (renamed >= 0),
  unavailable INTEGER NOT NULL DEFAULT 0 CHECK (unavailable >= 0),
  failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  error_summary TEXT,
  CHECK (changed + unchanged = processed)
);

CREATE TABLE library_scan_metadata (
  scan_id INTEGER NOT NULL REFERENCES library_reconciliations(scan_id) ON DELETE CASCADE,
  normalized_path TEXT NOT NULL CHECK (length(normalized_path) > 0),
  candidate_id TEXT NOT NULL CHECK (length(candidate_id) > 0),
  quick_fingerprint TEXT NOT NULL CHECK (length(quick_fingerprint) > 0),
  path TEXT NOT NULL CHECK (length(path) > 0),
  file TEXT NOT NULL CHECK (length(file) > 0),
  title TEXT NOT NULL,
  album TEXT NOT NULL,
  artist TEXT NOT NULL,
  genre TEXT NOT NULL,
  bpm INTEGER NOT NULL,
  compilation INTEGER NOT NULL,
  date TEXT NOT NULL,
  encoder TEXT NOT NULL,
  track_total INTEGER NOT NULL,
  track_number INTEGER NOT NULL,
  codec TEXT NOT NULL,
  duration TEXT NOT NULL,
  sample_rate TEXT NOT NULL,
  side INTEGER NOT NULL,
  visuals_path TEXT NOT NULL,
  PRIMARY KEY (scan_id, normalized_path)
) WITHOUT ROWID;

CREATE UNIQUE INDEX idx_library_reconciliations_one_processing_root
  ON library_reconciliations (root_id)
  WHERE status IN ('pending', 'preparing', 'applying');

CREATE INDEX idx_library_reconciliations_status_started
  ON library_reconciliations (status, started_at);

CREATE INDEX idx_library_scan_metadata_fingerprint
  ON library_scan_metadata (scan_id, quick_fingerprint);

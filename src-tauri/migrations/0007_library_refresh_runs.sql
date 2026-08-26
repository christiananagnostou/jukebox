CREATE TABLE library_refresh_runs (
  scan_id INTEGER PRIMARY KEY REFERENCES library_scans(id) ON DELETE CASCADE
);

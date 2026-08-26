CREATE TABLE library_storage_nodes (
  root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL CHECK (length(relative_path) > 0),
  parent_path TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('directory', 'track')),
  song_id TEXT REFERENCES songs(id) ON DELETE CASCADE,
  track_count INTEGER NOT NULL CHECK (track_count > 0),
  PRIMARY KEY (root_id, relative_path),
  CHECK (
    (kind = 'directory' AND song_id IS NULL)
    OR (kind = 'track' AND song_id IS NOT NULL AND track_count = 1)
  )
) WITHOUT ROWID;

CREATE INDEX idx_library_storage_nodes_parent
  ON library_storage_nodes (root_id, parent_path, kind, name COLLATE NOCASE, relative_path);

WITH RECURSIVE path_nodes (
  root_id, song_id, remainder, parent_path, name, relative_path, kind
) AS (
  SELECT
    root_id,
    id,
    normalized_path,
    '',
    CASE WHEN instr(normalized_path, '/') > 0
         THEN substr(normalized_path, 1, instr(normalized_path, '/') - 1)
         ELSE normalized_path END,
    CASE WHEN instr(normalized_path, '/') > 0
         THEN substr(normalized_path, 1, instr(normalized_path, '/') - 1)
         ELSE normalized_path END,
    CASE WHEN instr(normalized_path, '/') > 0 THEN 'directory' ELSE 'track' END
  FROM songs
  WHERE root_id IS NOT NULL AND normalized_path IS NOT NULL AND availability = 'available'

  UNION ALL

  SELECT
    root_id,
    song_id,
    substr(remainder, instr(remainder, '/') + 1),
    relative_path,
    CASE
      WHEN instr(substr(remainder, instr(remainder, '/') + 1), '/') > 0
      THEN substr(
        substr(remainder, instr(remainder, '/') + 1),
        1,
        instr(substr(remainder, instr(remainder, '/') + 1), '/') - 1
      )
      ELSE substr(remainder, instr(remainder, '/') + 1)
    END,
    relative_path || '/' || CASE
      WHEN instr(substr(remainder, instr(remainder, '/') + 1), '/') > 0
      THEN substr(
        substr(remainder, instr(remainder, '/') + 1),
        1,
        instr(substr(remainder, instr(remainder, '/') + 1), '/') - 1
      )
      ELSE substr(remainder, instr(remainder, '/') + 1)
    END,
    CASE WHEN instr(substr(remainder, instr(remainder, '/') + 1), '/') > 0
         THEN 'directory' ELSE 'track' END
  FROM path_nodes
  WHERE instr(remainder, '/') > 0
)
INSERT INTO library_storage_nodes (
  root_id, relative_path, parent_path, name, kind, song_id, track_count
)
SELECT
  root_id,
  relative_path,
  parent_path,
  name,
  kind,
  CASE WHEN kind = 'track' THEN MIN(song_id) END,
  COUNT(*)
FROM path_nodes
GROUP BY root_id, relative_path, parent_path, name, kind;

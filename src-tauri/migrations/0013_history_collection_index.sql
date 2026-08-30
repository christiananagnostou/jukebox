CREATE INDEX idx_play_history_completed_track
  ON play_history (track_id, started_at DESC, id DESC)
  WHERE completed = 1;

use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use std::collections::HashSet;

use super::state::{PlaybackSnapshot, SNAPSHOT_VERSION};

const MAX_SNAPSHOT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct PlaybackRepository {
    pool: SqlitePool,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct PlaybackPersistenceError {
    pub code: &'static str,
    pub message: &'static str,
}

impl PlaybackPersistenceError {
    fn invalid() -> Self {
        Self {
            code: "invalid_playback_session",
            message: "The saved playback session is invalid.",
        }
    }

    fn unavailable() -> Self {
        Self {
            code: "playback_persistence_unavailable",
            message: "The playback session could not be saved or restored.",
        }
    }
}

impl PlaybackRepository {
    pub(super) fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub(super) async fn load(&self) -> Result<Option<PlaybackSnapshot>, PlaybackPersistenceError> {
        let row = sqlx::query_as::<_, (i64, i64, String)>(
            "SELECT schema_version, snapshot_revision, snapshot_json
             FROM playback_session WHERE id = 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| PlaybackPersistenceError::unavailable())?;
        let Some((schema_version, snapshot_revision, snapshot_json)) = row else {
            return Ok(None);
        };
        if schema_version != i64::from(SNAPSHOT_VERSION) || snapshot_json.len() > MAX_SNAPSHOT_BYTES
        {
            return Err(PlaybackPersistenceError::invalid());
        }
        let snapshot = serde_json::from_str::<PlaybackSnapshot>(&snapshot_json)
            .map_err(|_| PlaybackPersistenceError::invalid())?;
        if snapshot
            .persistence_revision()
            .map_err(|_| PlaybackPersistenceError::invalid())?
            != snapshot_revision
        {
            return Err(PlaybackPersistenceError::invalid());
        }
        let referenced = snapshot.referenced_track_ids();
        let available = self.available_track_ids(&referenced).await?;
        let restored = snapshot
            .restored_from_persistence(&available)
            .map_err(|_| PlaybackPersistenceError::invalid())?;
        if restored.needs_recovery_checkpoint() {
            let _ = self.save(&restored).await;
        }
        Ok(Some(restored))
    }

    pub(super) async fn save(
        &self,
        snapshot: &PlaybackSnapshot,
    ) -> Result<(), PlaybackPersistenceError> {
        let snapshot = snapshot
            .committed_for_persistence()
            .map_err(|_| PlaybackPersistenceError::invalid())?;
        let snapshot_json =
            serde_json::to_string(&snapshot).map_err(|_| PlaybackPersistenceError::invalid())?;
        if snapshot_json.len() > MAX_SNAPSHOT_BYTES {
            return Err(PlaybackPersistenceError::invalid());
        }
        sqlx::query(
            "INSERT INTO playback_session (
               id, schema_version, snapshot_revision, snapshot_json, updated_at
             ) VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
               schema_version = excluded.schema_version,
               snapshot_revision = excluded.snapshot_revision,
               snapshot_json = excluded.snapshot_json,
               updated_at = CURRENT_TIMESTAMP
             WHERE excluded.snapshot_revision >= playback_session.snapshot_revision",
        )
        .bind(i64::from(SNAPSHOT_VERSION))
        .bind(
            snapshot
                .persistence_revision()
                .map_err(|_| PlaybackPersistenceError::invalid())?,
        )
        .bind(snapshot_json)
        .execute(&self.pool)
        .await
        .map_err(|_| PlaybackPersistenceError::unavailable())?;
        Ok(())
    }

    pub(super) async fn discard(&self) -> Result<(), PlaybackPersistenceError> {
        sqlx::query("DELETE FROM playback_session WHERE id = 1")
            .execute(&self.pool)
            .await
            .map_err(|_| PlaybackPersistenceError::unavailable())?;
        Ok(())
    }

    async fn available_track_ids(
        &self,
        track_ids: &[String],
    ) -> Result<HashSet<String>, PlaybackPersistenceError> {
        let mut available = HashSet::with_capacity(track_ids.len());
        for chunk in track_ids.chunks(500) {
            let mut builder = QueryBuilder::<Sqlite>::new(
                "SELECT id FROM songs WHERE availability = 'available' AND id IN (",
            );
            let mut separated = builder.separated(", ");
            for track_id in chunk {
                separated.push_bind(track_id);
            }
            separated.push_unseparated(")");
            let rows = builder
                .build_query_scalar::<String>()
                .fetch_all(&self.pool)
                .await
                .map_err(|_| PlaybackPersistenceError::unavailable())?;
            available.extend(rows);
        }
        Ok(available)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::PLAYBACK_SESSION_SCHEMA;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn repository() -> (SqlitePool, PlaybackRepository) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open playback fixture");
        sqlx::raw_sql(PLAYBACK_SESSION_SCHEMA)
            .execute(&pool)
            .await
            .expect("create playback session table");
        sqlx::raw_sql(
            "CREATE TABLE songs (
               id TEXT PRIMARY KEY,
               availability TEXT NOT NULL CHECK (availability IN ('available', 'unavailable'))
             );
             INSERT INTO songs (id, availability) VALUES
               ('one', 'available'), ('two', 'available'), ('bonus', 'available');",
        )
        .execute(&pool)
        .await
        .expect("create playback catalog fixture");
        (pool.clone(), PlaybackRepository::new(pool))
    }

    fn populated_snapshot(revision: u64, transition_pending: bool) -> PlaybackSnapshot {
        serde_json::from_value(json!({
            "context": { "cursor": 0, "order": [0, 1], "trackIds": ["one", "two"] },
            "current": {
                "contextIndex": 0,
                "queueEntryId": null,
                "resumeContextIndex": null,
                "trackId": "one"
            },
            "durationMs": 60_000,
            "error": null,
            "history": [],
            "muted": false,
            "persistenceWarning": false,
            "positionMs": 12_000,
            "queue": [{ "entryId": "queue-one", "trackId": "two" }],
            "repeatMode": "all",
            "revision": revision,
            "schemaVersion": SNAPSHOT_VERSION,
            "shuffle": { "enabled": false, "seed": 1 },
            "status": "playing",
            "transitionPending": transition_pending,
            "volumePercent": 80
        }))
        .expect("deserialize fixture snapshot")
    }

    #[test]
    fn atomic_replacement_round_trips_one_committed_session_without_autoplay() {
        tauri::async_runtime::block_on(async {
            let (pool, repository) = repository().await;
            repository
                .save(&populated_snapshot(7, false))
                .await
                .expect("save first snapshot");
            repository
                .save(&populated_snapshot(9, false))
                .await
                .expect("replace snapshot");

            let restored = repository
                .load()
                .await
                .expect("load snapshot")
                .expect("saved snapshot");
            let restored = serde_json::to_value(restored).expect("serialize restored snapshot");
            assert_eq!(restored["revision"], 10);
            assert_eq!(restored["status"], "paused");
            assert_eq!(restored["transitionPending"], false);
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM playback_session")
                    .fetch_one(&pool)
                    .await
                    .expect("count session rows"),
                1
            );
        });
    }

    #[test]
    fn pending_or_oversized_snapshots_never_replace_the_committed_row() {
        tauri::async_runtime::block_on(async {
            let (pool, repository) = repository().await;
            repository
                .save(&populated_snapshot(4, false))
                .await
                .expect("save committed snapshot");
            let original: String =
                sqlx::query_scalar("SELECT snapshot_json FROM playback_session WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read committed JSON");

            let pending = repository
                .save(&populated_snapshot(5, true))
                .await
                .expect_err("reject pending snapshot");
            assert_eq!(pending.code, "invalid_playback_session");

            let mut oversized = serde_json::to_value(populated_snapshot(5, false))
                .expect("serialize oversized base");
            let track_ids = (0..=10_000)
                .map(|index| json!(format!("track-{index}")))
                .collect::<Vec<_>>();
            let order = (0..=10_000).map(|index| json!(index)).collect::<Vec<_>>();
            oversized["context"]["trackIds"] = track_ids.into();
            oversized["context"]["order"] = order.into();
            let oversized: PlaybackSnapshot =
                serde_json::from_value(oversized).expect("deserialize oversized snapshot");
            let invalid = repository
                .save(&oversized)
                .await
                .expect_err("reject oversized snapshot");
            assert_eq!(invalid.code, "invalid_playback_session");

            let unchanged: String =
                sqlx::query_scalar("SELECT snapshot_json FROM playback_session WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("reread committed JSON");
            assert_eq!(unchanged, original);
        });
    }

    #[test]
    fn malformed_unknown_or_constraint_violating_rows_fail_closed() {
        tauri::async_runtime::block_on(async {
            let (pool, repository) = repository().await;
            sqlx::query(
                "INSERT INTO playback_session (
                   id, schema_version, snapshot_revision, snapshot_json
                 ) VALUES (1, 1, 0, ?)",
            )
            .bind("{}")
            .execute(&pool)
            .await
            .expect("insert malformed JSON object");
            assert_eq!(
                repository
                    .load()
                    .await
                    .expect_err("reject malformed row")
                    .code,
                "invalid_playback_session"
            );

            let second_row = sqlx::query(
                "INSERT INTO playback_session (
                   id, schema_version, snapshot_revision, snapshot_json
                 ) VALUES (2, 1, 0, '{}')",
            )
            .execute(&pool)
            .await;
            let wrong_version =
                sqlx::query("UPDATE playback_session SET schema_version = 2 WHERE id = 1")
                    .execute(&pool)
                    .await;
            let empty_json =
                sqlx::query("UPDATE playback_session SET snapshot_json = '' WHERE id = 1")
                    .execute(&pool)
                    .await;
            assert!(second_row.is_err());
            assert!(wrong_version.is_err());
            assert!(empty_json.is_err());
        });
    }

    #[test]
    fn restore_prunes_unavailable_tracks_and_keeps_queue_precedence_without_autoplay() {
        tauri::async_runtime::block_on(async {
            let (pool, repository) = repository().await;
            repository
                .save(&populated_snapshot(7, false))
                .await
                .expect("save committed snapshot");
            sqlx::query("UPDATE songs SET availability = 'unavailable' WHERE id = 'one'")
                .execute(&pool)
                .await
                .expect("mark current track unavailable");

            let restored = repository
                .load()
                .await
                .expect("load pruned session")
                .expect("saved session");
            let restored = serde_json::to_value(restored).expect("serialize pruned session");
            assert_eq!(restored["revision"], 8);
            assert_eq!(restored["status"], "paused");
            assert_eq!(restored["persistenceWarning"], true);
            assert_eq!(restored["context"]["trackIds"], json!(["two"]));
            assert_eq!(restored["current"]["trackId"], "two");
            assert_eq!(restored["current"]["queueEntryId"], "queue-one");
            assert_eq!(restored["queue"], json!([]));

            let clean = repository
                .load()
                .await
                .expect("load recovery checkpoint")
                .expect("recovered session");
            let clean = serde_json::to_value(clean).expect("serialize recovery checkpoint");
            assert_eq!(clean["persistenceWarning"], false);
            assert_eq!(clean["error"], serde_json::Value::Null);
            assert_eq!(clean["context"]["trackIds"], json!(["two"]));
        });
    }

    #[test]
    fn stored_revision_column_must_match_the_snapshot_revision() {
        tauri::async_runtime::block_on(async {
            let (pool, repository) = repository().await;
            repository
                .save(&populated_snapshot(7, false))
                .await
                .expect("save committed snapshot");
            sqlx::query("UPDATE playback_session SET snapshot_revision = 8 WHERE id = 1")
                .execute(&pool)
                .await
                .expect("corrupt revision column");

            assert_eq!(
                repository
                    .load()
                    .await
                    .expect_err("reject mismatched revision")
                    .code,
                "invalid_playback_session"
            );
        });
    }

    #[test]
    fn restore_preserves_an_intentionally_stopped_context_and_queue() {
        tauri::async_runtime::block_on(async {
            let (_pool, repository) = repository().await;
            let mut snapshot = serde_json::to_value(populated_snapshot(7, false))
                .expect("serialize stopped fixture");
            snapshot["current"] = serde_json::Value::Null;
            snapshot["durationMs"] = json!(0);
            snapshot["positionMs"] = json!(0);
            snapshot["status"] = json!("stopped");
            let snapshot = serde_json::from_value(snapshot).expect("deserialize stopped fixture");
            repository
                .save(&snapshot)
                .await
                .expect("save stopped session");

            let restored = repository
                .load()
                .await
                .expect("load stopped session")
                .expect("saved stopped session");
            let restored = serde_json::to_value(restored).expect("serialize stopped session");
            assert_eq!(restored["status"], "stopped");
            assert_eq!(restored["current"], serde_json::Value::Null);
            assert_eq!(restored["queue"][0]["entryId"], "queue-one");
            assert_eq!(restored["persistenceWarning"], false);
        });
    }
}

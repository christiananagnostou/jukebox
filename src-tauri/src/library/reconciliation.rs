use super::query::LibraryError;
use crate::metadata::{extract_metadata, hash_string};
use serde::Serialize;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tokio::task::JoinSet;

const METADATA_VERSION: i64 = 1;
const QUERY_BATCH_SIZE: i64 = 100;
const WRITE_BATCH_SIZE: usize = 100;
const FINGERPRINT_SAMPLE_SIZE: usize = 64 * 1024;
const MAX_METADATA_WORKERS: usize = 4;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryReconciliation {
    pub scan_id: i64,
    pub root_id: i64,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub total: i64,
    pub processed: i64,
    pub changed: i64,
    pub unchanged: i64,
    pub renamed: i64,
    pub unavailable: i64,
    pub failed: i64,
    pub error_summary: Option<String>,
}

#[derive(Clone, Debug)]
struct ObservedFile {
    normalized_path: String,
    file_size: i64,
    modified_at_ns: i64,
}

#[derive(Debug)]
struct PreparedMetadata {
    normalized_path: String,
    candidate_id: String,
    quick_fingerprint: String,
    path: String,
    file: String,
    title: String,
    album: String,
    artist: String,
    genre: String,
    bpm: i64,
    compilation: i64,
    date: String,
    encoder: String,
    track_total: i64,
    track_number: i64,
    codec: String,
    duration: String,
    sample_rate: String,
    side: i64,
    visuals_path: String,
}

#[derive(Debug)]
struct ScanContext {
    root_id: i64,
    root_path: PathBuf,
    total: i64,
}

#[derive(Clone)]
pub struct ReconciliationService {
    active: Arc<Mutex<HashMap<i64, Arc<AtomicBool>>>>,
    pool: SqlitePool,
}

pub(crate) struct PreparationTask {
    pub reconciliation: LibraryReconciliation,
    context: ScanContext,
    cancelled: Arc<AtomicBool>,
}

impl ReconciliationService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
            pool,
        }
    }

    pub async fn recover_interrupted(&self) -> Result<(), LibraryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LibraryError::database())?;
        sqlx::query(
            "DELETE FROM library_scan_metadata
             WHERE scan_id IN (
               SELECT scan_id FROM library_reconciliations
               WHERE status IN ('pending', 'preparing', 'applying')
             )",
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
        sqlx::query(
            "UPDATE library_reconciliations
             SET status = 'interrupted', completed_at = CURRENT_TIMESTAMP,
                 error_summary = 'The application stopped before library preparation completed.'
             WHERE status IN ('pending', 'preparing', 'applying')",
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
        transaction
            .commit()
            .await
            .map_err(|_| LibraryError::database())?;
        Ok(())
    }

    pub async fn start(
        &self,
        scan_id: i64,
        app: tauri::AppHandle,
    ) -> Result<LibraryReconciliation, LibraryError> {
        let task = self
            .begin(scan_id, Arc::new(AtomicBool::new(false)))
            .await?;
        let reconciliation = task.reconciliation.clone();
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let _ = service.complete(task, Some(app)).await;
        });
        Ok(reconciliation)
    }

    pub(crate) async fn begin(
        &self,
        scan_id: i64,
        cancelled: Arc<AtomicBool>,
    ) -> Result<PreparationTask, LibraryError> {
        let context = self.load_scan_context(scan_id).await?;
        let reconciliation = self.create(scan_id, context.root_id, context.total).await?;
        self.active
            .lock()
            .map_err(|_| LibraryError::database())?
            .insert(scan_id, cancelled.clone());
        Ok(PreparationTask {
            reconciliation,
            context,
            cancelled,
        })
    }

    pub(crate) async fn complete(
        &self,
        task: PreparationTask,
        app: Option<tauri::AppHandle>,
    ) -> Result<LibraryReconciliation, LibraryError> {
        let scan_id = task.reconciliation.scan_id;
        self.run_prepare(scan_id, task.context.root_path, task.cancelled, app)
            .await;
        if let Ok(mut active) = self.active.lock() {
            active.remove(&scan_id);
        }
        self.get(scan_id).await
    }

    async fn load_scan_context(&self, scan_id: i64) -> Result<ScanContext, LibraryError> {
        let row = sqlx::query(
            "SELECT scans.root_id, roots.canonical_path, scans.discovered
             FROM library_scans AS scans
             JOIN library_roots AS roots ON roots.id = scans.root_id
             WHERE scans.id = ? AND scans.status = 'completed' AND roots.enabled = 1
               AND NOT EXISTS (
                 SELECT 1 FROM library_scans AS newer
                 WHERE newer.root_id = scans.root_id
                   AND newer.status = 'completed' AND newer.id > scans.id
               )",
        )
        .bind(scan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?
        .ok_or_else(LibraryError::scan_not_ready)?;
        Ok(ScanContext {
            root_id: row
                .try_get("root_id")
                .map_err(|_| LibraryError::database())?,
            root_path: PathBuf::from(
                row.try_get::<String, _>("canonical_path")
                    .map_err(|_| LibraryError::database())?,
            ),
            total: row
                .try_get("discovered")
                .map_err(|_| LibraryError::database())?,
        })
    }

    pub async fn cancel(&self, scan_id: i64) -> Result<LibraryReconciliation, LibraryError> {
        let cancelled = self
            .active
            .lock()
            .map_err(|_| LibraryError::database())?
            .get(&scan_id)
            .cloned();
        if let Some(cancelled) = cancelled {
            cancelled.store(true, Ordering::Release);
        }
        self.get(scan_id).await
    }

    pub async fn get(&self, scan_id: i64) -> Result<LibraryReconciliation, LibraryError> {
        self.get_optional(scan_id)
            .await?
            .ok_or_else(LibraryError::reconciliation_not_found)
    }

    pub(crate) async fn get_optional(
        &self,
        scan_id: i64,
    ) -> Result<Option<LibraryReconciliation>, LibraryError> {
        let row = sqlx::query(
            "SELECT scan_id, root_id, status, started_at, completed_at, total,
                    processed, changed, unchanged, renamed, unavailable, failed, error_summary
             FROM library_reconciliations WHERE scan_id = ?",
        )
        .bind(scan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?;
        row.map(|row| reconciliation_from_row(&row)).transpose()
    }

    pub(crate) async fn settle_cancelled(&self, scan_id: i64) -> Result<(), LibraryError> {
        self.finish_unsuccessful(scan_id, "cancelled").await
    }

    pub async fn apply(&self, scan_id: i64) -> Result<LibraryReconciliation, LibraryError> {
        if let Err(error) = self.load_scan_context(scan_id).await {
            let _ = self.finish_apply_failure(scan_id).await;
            return Err(error);
        }
        self.mark_applying(scan_id).await?;
        if let Err(error) = self.apply_ready_with_hook(scan_id, || Ok(())).await {
            let _ = self.finish_apply_failure(scan_id).await;
            return Err(error);
        }
        self.get(scan_id).await
    }

    async fn create(
        &self,
        scan_id: i64,
        root_id: i64,
        total: i64,
    ) -> Result<LibraryReconciliation, LibraryError> {
        let row = sqlx::query(
            "INSERT INTO library_reconciliations (scan_id, root_id, status, total)
             VALUES (?, ?, 'pending', ?)
             RETURNING scan_id, root_id, status, started_at, completed_at, total,
                       processed, changed, unchanged, renamed, unavailable, failed, error_summary",
        )
        .bind(scan_id)
        .bind(root_id)
        .bind(total)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|database| database.is_unique_violation())
            {
                LibraryError::reconciliation_in_progress()
            } else {
                LibraryError::database()
            }
        })?;
        reconciliation_from_row(&row)
    }

    async fn mark_applying(&self, scan_id: i64) -> Result<(), LibraryError> {
        let result = sqlx::query(
            "UPDATE library_reconciliations SET status = 'applying'
             WHERE scan_id = ? AND status = 'ready' AND processed = total",
        )
        .bind(scan_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|database| database.is_unique_violation())
            {
                LibraryError::reconciliation_in_progress()
            } else {
                LibraryError::database()
            }
        })?;
        if result.rows_affected() != 1 {
            return Err(LibraryError::reconciliation_not_ready());
        }
        Ok(())
    }

    async fn apply_ready_with_hook<F>(
        &self,
        scan_id: i64,
        after_upsert: F,
    ) -> Result<(), LibraryError>
    where
        F: FnOnce() -> Result<(), LibraryError>,
    {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LibraryError::database())?;
        let result = async {
            // The first write reserves the SQLite writer before freshness is rechecked.
            sqlx::query(
                "UPDATE library_reconciliations SET status = status
                 WHERE scan_id = ? AND status = 'applying'",
            )
            .bind(scan_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;

            let root_id: i64 = sqlx::query_scalar(
                "SELECT reconciliation.root_id
                 FROM library_reconciliations AS reconciliation
                 JOIN library_scans AS scans ON scans.id = reconciliation.scan_id
                 JOIN library_roots AS roots ON roots.id = reconciliation.root_id
                 WHERE reconciliation.scan_id = ? AND reconciliation.status = 'applying'
                   AND scans.status = 'completed' AND roots.enabled = 1
                   AND NOT EXISTS (
                     SELECT 1 FROM library_scans AS newer
                     WHERE newer.root_id = reconciliation.root_id
                       AND newer.status = 'completed' AND newer.id > reconciliation.scan_id
                   )",
            )
            .bind(scan_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?
            .ok_or_else(LibraryError::scan_not_ready)?;

            sqlx::query(
                "UPDATE library_scan_metadata AS metadata
                 SET matched_song_id = (
                   SELECT CASE WHEN COUNT(*) = 1 THEN MIN(old.id) END
                   FROM songs AS old
                   JOIN library_scan_files AS observed
                     ON observed.scan_id = metadata.scan_id
                    AND observed.normalized_path = metadata.normalized_path
                   WHERE old.root_id = ? AND old.normalized_path IS NOT NULL
                     AND old.file_size = observed.file_size
                     AND old.quick_fingerprint = metadata.quick_fingerprint
                     AND NOT EXISTS (
                       SELECT 1 FROM library_scan_files AS current_snapshot
                       WHERE current_snapshot.scan_id = metadata.scan_id
                         AND current_snapshot.normalized_path = old.normalized_path
                     )
                 )
                 WHERE metadata.scan_id = ?
                   AND NOT EXISTS (
                     SELECT 1 FROM songs AS same_path
                     WHERE same_path.root_id = ?
                       AND same_path.normalized_path = metadata.normalized_path
                   )
                   AND 1 = (
                     SELECT COUNT(*)
                     FROM library_scan_metadata AS peer
                     JOIN library_scan_files AS peer_file
                       ON peer_file.scan_id = peer.scan_id
                      AND peer_file.normalized_path = peer.normalized_path
                     JOIN library_scan_files AS current_file
                       ON current_file.scan_id = metadata.scan_id
                      AND current_file.normalized_path = metadata.normalized_path
                     WHERE peer.scan_id = metadata.scan_id
                       AND peer.quick_fingerprint = metadata.quick_fingerprint
                       AND peer_file.file_size = current_file.file_size
                   )",
            )
            .bind(root_id)
            .bind(scan_id)
            .bind(root_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;

            let identity_collisions: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)
                 FROM library_scan_metadata AS metadata
                 JOIN songs AS collision ON collision.id = metadata.candidate_id
                 WHERE metadata.scan_id = ? AND metadata.matched_song_id IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM songs AS same_path
                     WHERE same_path.root_id = ?
                       AND same_path.normalized_path = metadata.normalized_path
                   )",
            )
            .bind(scan_id)
            .bind(root_id)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
            if identity_collisions > 0 {
                return Err(LibraryError::identity_collision());
            }

            sqlx::query(
                "INSERT INTO songs (
                   id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
                   trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
                   favorRating, dateAdded, visualsPath, root_id, normalized_path, file_size,
                   modified_at_ns, quick_fingerprint, availability, last_seen_scan_id,
                   metadata_version
                 )
                 SELECT
                   COALESCE(same_path.id, metadata.matched_song_id, metadata.candidate_id),
                   metadata.path, metadata.file, metadata.title, metadata.album, metadata.artist,
                   metadata.genre, metadata.bpm, metadata.compilation, metadata.date,
                   metadata.encoder, metadata.track_total, metadata.track_number, metadata.codec,
                   metadata.duration, metadata.sample_rate, metadata.side, 0, 0,
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), metadata.visuals_path, ?,
                   metadata.normalized_path,
                   observed.file_size, observed.modified_at_ns, metadata.quick_fingerprint,
                   'available', ?, ?
                 FROM library_scan_metadata AS metadata
                 JOIN library_scan_files AS observed
                   ON observed.scan_id = metadata.scan_id
                  AND observed.normalized_path = metadata.normalized_path
                 LEFT JOIN songs AS same_path
                   ON same_path.root_id = ?
                  AND same_path.normalized_path = metadata.normalized_path
                 WHERE metadata.scan_id = ?
                 ON CONFLICT(id) DO UPDATE SET
                   path = excluded.path,
                   file = excluded.file,
                   title = excluded.title,
                   album = excluded.album,
                   artist = excluded.artist,
                   genre = excluded.genre,
                   bpm = excluded.bpm,
                   compilation = excluded.compilation,
                   date = excluded.date,
                   encoder = excluded.encoder,
                   trackTotal = excluded.trackTotal,
                   trackNumber = excluded.trackNumber,
                   codec = excluded.codec,
                   duration = excluded.duration,
                   sampleRate = excluded.sampleRate,
                   side = excluded.side,
                   visualsPath = excluded.visualsPath,
                   root_id = excluded.root_id,
                   normalized_path = excluded.normalized_path,
                   file_size = excluded.file_size,
                   modified_at_ns = excluded.modified_at_ns,
                   quick_fingerprint = excluded.quick_fingerprint,
                   availability = excluded.availability,
                   last_seen_scan_id = excluded.last_seen_scan_id,
                   metadata_version = excluded.metadata_version",
            )
            .bind(root_id)
            .bind(scan_id)
            .bind(METADATA_VERSION)
            .bind(root_id)
            .bind(scan_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;

            after_upsert()?;

            sqlx::query(
                "UPDATE songs
                 SET last_seen_scan_id = ?
                 WHERE root_id = ? AND availability = 'available'
                   AND last_seen_scan_id IS NOT ?
                   AND EXISTS (
                     SELECT 1 FROM library_scan_files AS observed
                     WHERE observed.scan_id = ?
                       AND observed.normalized_path = songs.normalized_path
                   )",
            )
            .bind(scan_id)
            .bind(root_id)
            .bind(scan_id)
            .bind(scan_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;

            sqlx::query(
                "UPDATE songs
                 SET availability = 'available', last_seen_scan_id = ?
                 WHERE root_id = ? AND availability = 'unavailable'
                   AND EXISTS (
                     SELECT 1 FROM library_scan_files AS observed
                     WHERE observed.scan_id = ?
                       AND observed.normalized_path = songs.normalized_path
                   )",
            )
            .bind(scan_id)
            .bind(root_id)
            .bind(scan_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;

            let unavailable: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM songs
                 WHERE root_id = ? AND availability = 'available'
                   AND NOT EXISTS (
                     SELECT 1 FROM library_scan_files AS observed
                     WHERE observed.scan_id = ?
                       AND observed.normalized_path = songs.normalized_path
                   )",
            )
            .bind(root_id)
            .bind(scan_id)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
            sqlx::query(
                "UPDATE songs SET availability = 'unavailable'
                 WHERE root_id = ? AND availability = 'available'
                   AND NOT EXISTS (
                     SELECT 1 FROM library_scan_files AS observed
                     WHERE observed.scan_id = ?
                       AND observed.normalized_path = songs.normalized_path
                   )",
            )
            .bind(root_id)
            .bind(scan_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;

            let renamed: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM library_scan_metadata
                 WHERE scan_id = ? AND matched_song_id IS NOT NULL",
            )
            .bind(scan_id)
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
            let changed: i64 =
                sqlx::query_scalar("SELECT changed FROM library_reconciliations WHERE scan_id = ?")
                    .bind(scan_id)
                    .fetch_one(&mut *transaction)
                    .await
                    .map_err(|_| LibraryError::database())?;

            sqlx::query(
                "UPDATE library_scans
                 SET updated = ?, unavailable = ?, failed = 0, error_summary = NULL
                 WHERE id = ?",
            )
            .bind(changed)
            .bind(unavailable)
            .bind(scan_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
            sqlx::query("UPDATE library_roots SET last_scan_at = CURRENT_TIMESTAMP WHERE id = ?")
                .bind(root_id)
                .execute(&mut *transaction)
                .await
                .map_err(|_| LibraryError::database())?;
            sqlx::query(
                "UPDATE library_reconciliations
                 SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
                     renamed = ?, unavailable = ?, failed = 0, error_summary = NULL
                 WHERE scan_id = ? AND status = 'applying'",
            )
            .bind(renamed)
            .bind(unavailable)
            .bind(scan_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
            sqlx::query("DELETE FROM library_scan_metadata WHERE scan_id = ?")
                .bind(scan_id)
                .execute(&mut *transaction)
                .await
                .map_err(|_| LibraryError::database())?;

            Ok(())
        }
        .await;

        match result {
            Ok(()) => transaction
                .commit()
                .await
                .map_err(|_| LibraryError::database()),
            Err(error) => {
                transaction
                    .rollback()
                    .await
                    .map_err(|_| LibraryError::database())?;
                Err(error)
            }
        }
    }

    async fn finish_apply_failure(&self, scan_id: i64) -> Result<(), LibraryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LibraryError::database())?;
        sqlx::query("DELETE FROM library_scan_metadata WHERE scan_id = ?")
            .bind(scan_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
        sqlx::query(
            "UPDATE library_reconciliations
             SET status = 'failed', completed_at = CURRENT_TIMESTAMP, failed = 1,
                 error_summary = 'Jukebox could not apply this library snapshot.'
             WHERE scan_id = ? AND status IN ('ready', 'applying')",
        )
        .bind(scan_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
        transaction
            .commit()
            .await
            .map_err(|_| LibraryError::database())?;
        Ok(())
    }

    async fn run_prepare(
        &self,
        scan_id: i64,
        root: PathBuf,
        cancelled: Arc<AtomicBool>,
        app: Option<tauri::AppHandle>,
    ) {
        if self.mark_preparing(scan_id).await.is_err() {
            return;
        }
        let worker_count = std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1)
            .min(MAX_METADATA_WORKERS);
        let mut cursor = String::new();
        let mut workers = JoinSet::new();
        let mut staged = Vec::with_capacity(WRITE_BATCH_SIZE);

        loop {
            if cancelled.load(Ordering::Acquire) {
                workers.abort_all();
                let _ = self.finish_unsuccessful(scan_id, "cancelled").await;
                return;
            }
            let page = match self.load_page(scan_id, &cursor).await {
                Ok(page) => page,
                Err(_) => {
                    workers.abort_all();
                    let _ = self.finish_unsuccessful(scan_id, "failed").await;
                    return;
                }
            };
            if page.is_empty() {
                break;
            }
            cursor = page
                .last()
                .map(|(file, _)| file.normalized_path.clone())
                .unwrap_or_default();

            let unchanged = page.iter().filter(|(_, unchanged)| *unchanged).count();
            if unchanged > 0
                && self
                    .record_unchanged(scan_id, unchanged as i64)
                    .await
                    .is_err()
            {
                workers.abort_all();
                let _ = self.finish_unsuccessful(scan_id, "failed").await;
                return;
            }

            for (observation, unchanged) in page {
                if unchanged {
                    continue;
                }
                if cancelled.load(Ordering::Acquire) {
                    workers.abort_all();
                    let _ = self.finish_unsuccessful(scan_id, "cancelled").await;
                    return;
                }
                while workers.len() >= worker_count {
                    if !self
                        .collect_worker(scan_id, &mut workers, &mut staged)
                        .await
                    {
                        workers.abort_all();
                        let _ = self.finish_unsuccessful(scan_id, "failed").await;
                        return;
                    }
                }
                let worker_root = root.clone();
                let worker_app = app.clone();
                workers.spawn_blocking(move || {
                    prepare_file(&worker_root, observation, worker_app.as_ref())
                });
            }
        }

        while !workers.is_empty() {
            if !self
                .collect_worker(scan_id, &mut workers, &mut staged)
                .await
            {
                workers.abort_all();
                let _ = self.finish_unsuccessful(scan_id, "failed").await;
                return;
            }
        }
        if !staged.is_empty() && self.write_metadata(scan_id, &staged).await.is_err() {
            let _ = self.finish_unsuccessful(scan_id, "failed").await;
            return;
        }
        if cancelled.load(Ordering::Acquire) {
            let _ = self.finish_unsuccessful(scan_id, "cancelled").await;
            return;
        }
        if self.mark_ready(scan_id).await.is_err() {
            let _ = self.finish_unsuccessful(scan_id, "failed").await;
        }
    }

    async fn collect_worker(
        &self,
        scan_id: i64,
        workers: &mut JoinSet<Result<PreparedMetadata, ()>>,
        staged: &mut Vec<PreparedMetadata>,
    ) -> bool {
        match workers.join_next().await {
            Some(Ok(Ok(metadata))) => staged.push(metadata),
            _ => return false,
        }
        if staged.len() == WRITE_BATCH_SIZE {
            if self.write_metadata(scan_id, staged).await.is_err() {
                return false;
            }
            staged.clear();
        }
        true
    }

    async fn load_page(
        &self,
        scan_id: i64,
        cursor: &str,
    ) -> Result<Vec<(ObservedFile, bool)>, LibraryError> {
        let rows = sqlx::query(
            "SELECT files.normalized_path, files.file_size, files.modified_at_ns,
                    CASE WHEN songs.id IS NOT NULL
                              AND songs.file_size = files.file_size
                              AND songs.modified_at_ns = files.modified_at_ns
                              AND songs.metadata_version = ?
                         THEN 1 ELSE 0 END AS unchanged
             FROM library_scan_files AS files
             JOIN library_scans AS scans ON scans.id = files.scan_id
             LEFT JOIN songs
               ON songs.root_id = scans.root_id
              AND songs.normalized_path = files.normalized_path
             WHERE files.scan_id = ? AND files.normalized_path > ?
             ORDER BY files.normalized_path
             LIMIT ?",
        )
        .bind(METADATA_VERSION)
        .bind(scan_id)
        .bind(cursor)
        .bind(QUERY_BATCH_SIZE)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?;
        rows.into_iter()
            .map(|row| {
                Ok((
                    ObservedFile {
                        normalized_path: row
                            .try_get("normalized_path")
                            .map_err(|_| LibraryError::database())?,
                        file_size: row
                            .try_get("file_size")
                            .map_err(|_| LibraryError::database())?,
                        modified_at_ns: row
                            .try_get("modified_at_ns")
                            .map_err(|_| LibraryError::database())?,
                    },
                    row.try_get::<i64, _>("unchanged")
                        .map_err(|_| LibraryError::database())?
                        == 1,
                ))
            })
            .collect()
    }

    async fn record_unchanged(&self, scan_id: i64, count: i64) -> Result<(), LibraryError> {
        sqlx::query(
            "UPDATE library_reconciliations
             SET processed = processed + ?, unchanged = unchanged + ?
             WHERE scan_id = ? AND status = 'preparing'",
        )
        .bind(count)
        .bind(count)
        .bind(scan_id)
        .execute(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?;
        Ok(())
    }

    async fn write_metadata(
        &self,
        scan_id: i64,
        batch: &[PreparedMetadata],
    ) -> Result<(), LibraryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LibraryError::database())?;
        let mut query = QueryBuilder::<Sqlite>::new(
            "INSERT INTO library_scan_metadata (
               scan_id, normalized_path, candidate_id, quick_fingerprint, path, file,
               title, album, artist, genre, bpm, compilation, date, encoder,
               track_total, track_number, codec, duration, sample_rate, side, visuals_path
             ) ",
        );
        query.push_values(batch, |mut row, metadata| {
            row.push_bind(scan_id)
                .push_bind(&metadata.normalized_path)
                .push_bind(&metadata.candidate_id)
                .push_bind(&metadata.quick_fingerprint)
                .push_bind(&metadata.path)
                .push_bind(&metadata.file)
                .push_bind(&metadata.title)
                .push_bind(&metadata.album)
                .push_bind(&metadata.artist)
                .push_bind(&metadata.genre)
                .push_bind(metadata.bpm)
                .push_bind(metadata.compilation)
                .push_bind(&metadata.date)
                .push_bind(&metadata.encoder)
                .push_bind(metadata.track_total)
                .push_bind(metadata.track_number)
                .push_bind(&metadata.codec)
                .push_bind(&metadata.duration)
                .push_bind(&metadata.sample_rate)
                .push_bind(metadata.side)
                .push_bind(&metadata.visuals_path);
        });
        query
            .build()
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
        sqlx::query(
            "UPDATE library_reconciliations
             SET processed = processed + ?, changed = changed + ?
             WHERE scan_id = ? AND status = 'preparing'",
        )
        .bind(batch.len() as i64)
        .bind(batch.len() as i64)
        .bind(scan_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
        transaction
            .commit()
            .await
            .map_err(|_| LibraryError::database())?;
        Ok(())
    }

    async fn mark_preparing(&self, scan_id: i64) -> Result<(), LibraryError> {
        let result = sqlx::query(
            "UPDATE library_reconciliations SET status = 'preparing'
             WHERE scan_id = ? AND status = 'pending'",
        )
        .bind(scan_id)
        .execute(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?;
        if result.rows_affected() != 1 {
            return Err(LibraryError::database());
        }
        Ok(())
    }

    async fn mark_ready(&self, scan_id: i64) -> Result<(), LibraryError> {
        let result = sqlx::query(
            "UPDATE library_reconciliations SET status = 'ready'
             WHERE scan_id = ? AND status = 'preparing' AND processed = total",
        )
        .bind(scan_id)
        .execute(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?;
        if result.rows_affected() != 1 {
            return Err(LibraryError::database());
        }
        Ok(())
    }

    async fn finish_unsuccessful(&self, scan_id: i64, status: &str) -> Result<(), LibraryError> {
        let error_summary = if status == "cancelled" {
            "Library preparation was cancelled."
        } else {
            "Jukebox could not prepare this library snapshot."
        };
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LibraryError::database())?;
        sqlx::query("DELETE FROM library_scan_metadata WHERE scan_id = ?")
            .bind(scan_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
        sqlx::query(
            "UPDATE library_reconciliations
             SET status = ?, completed_at = CURRENT_TIMESTAMP,
                 failed = CASE WHEN ? = 'failed' THEN 1 ELSE failed END,
                 error_summary = ?
             WHERE scan_id = ? AND status IN ('pending', 'preparing', 'ready')",
        )
        .bind(status)
        .bind(status)
        .bind(error_summary)
        .bind(scan_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
        transaction
            .commit()
            .await
            .map_err(|_| LibraryError::database())?;
        Ok(())
    }
}

fn prepare_file(
    root: &Path,
    observation: ObservedFile,
    app: Option<&tauri::AppHandle>,
) -> Result<PreparedMetadata, ()> {
    let path = resolve_observed_file(root, &observation)?;
    let quick_fingerprint = quick_fingerprint(&path, observation.file_size)?;
    let extracted = extract_metadata(&path).map_err(|_| ())?;
    verify_observation(&path, &observation)?;
    let path_string = path.to_string_lossy().into_owned();
    let candidate_id = hash_string(&path_string);
    let visuals_path = app
        .map(|app| extracted.cache_visual_path(app, &candidate_id))
        .transpose()
        .map_err(|_| ())?
        .unwrap_or_default();
    let file = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .ok_or(())?;
    let title = tag(&extracted.meta_tags, "TrackTitle")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| file.clone());

    Ok(PreparedMetadata {
        normalized_path: observation.normalized_path,
        candidate_id,
        quick_fingerprint,
        path: path_string,
        file,
        title,
        album: tag(&extracted.meta_tags, "Album").unwrap_or_default(),
        artist: tag(&extracted.meta_tags, "Artist").unwrap_or_default(),
        genre: tag(&extracted.meta_tags, "Genre").unwrap_or_default(),
        bpm: integer_tag(&extracted.meta_tags, "Bpm"),
        compilation: integer_tag(&extracted.meta_tags, "Compilation"),
        date: tag(&extracted.meta_tags, "Date").unwrap_or_default(),
        encoder: tag(&extracted.meta_tags, "Encoder").unwrap_or_default(),
        track_total: integer_tag(&extracted.meta_tags, "TrackTotal"),
        track_number: integer_tag(&extracted.meta_tags, "TrackNumber"),
        codec: extracted.codec,
        duration: extracted.duration,
        sample_rate: extracted.sample_rate.to_string(),
        side: tag(&extracted.meta_tags, "DiscNumber")
            .or_else(|| tag(&extracted.meta_tags, "Side"))
            .and_then(|value| value.parse().ok())
            .unwrap_or_default(),
        visuals_path,
    })
}

fn resolve_observed_file(root: &Path, observation: &ObservedFile) -> Result<PathBuf, ()> {
    let relative = Path::new(&observation.normalized_path);
    if !relative
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(());
    }
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err(());
        };
        current.push(component);
        if std::fs::symlink_metadata(&current)
            .map_err(|_| ())?
            .file_type()
            .is_symlink()
        {
            return Err(());
        }
    }
    let canonical = current.canonicalize().map_err(|_| ())?;
    if !canonical.starts_with(root) {
        return Err(());
    }
    verify_observation(&canonical, observation)?;
    Ok(canonical)
}

fn verify_observation(path: &Path, observation: &ObservedFile) -> Result<(), ()> {
    let metadata = path.metadata().map_err(|_| ())?;
    if !metadata.is_file() || metadata.len().min(i64::MAX as u64) as i64 != observation.file_size {
        return Err(());
    }
    let modified_at_ns = metadata
        .modified()
        .map_err(|_| ())?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ())?
        .as_nanos()
        .min(i64::MAX as u128) as i64;
    (modified_at_ns == observation.modified_at_ns)
        .then_some(())
        .ok_or(())
}

fn quick_fingerprint(path: &Path, file_size: i64) -> Result<String, ()> {
    let mut file = File::open(path).map_err(|_| ())?;
    let mut context = md5::Context::new();
    context.consume(file_size.to_le_bytes());
    let size = usize::try_from(file_size).map_err(|_| ())?;
    if size <= FINGERPRINT_SAMPLE_SIZE * 2 {
        let mut contents = Vec::with_capacity(size);
        file.read_to_end(&mut contents).map_err(|_| ())?;
        context.consume(contents);
    } else {
        let mut sample = vec![0_u8; FINGERPRINT_SAMPLE_SIZE];
        file.read_exact(&mut sample).map_err(|_| ())?;
        context.consume(&sample);
        file.seek(SeekFrom::End(-(FINGERPRINT_SAMPLE_SIZE as i64)))
            .map_err(|_| ())?;
        file.read_exact(&mut sample).map_err(|_| ())?;
        context.consume(sample);
    }
    Ok(format!("{:x}", context.finalize()))
}

fn tag(tags: &HashMap<String, String>, key: &str) -> Option<String> {
    tags.get(key).cloned()
}

fn integer_tag(tags: &HashMap<String, String>, key: &str) -> i64 {
    tags.get(key)
        .and_then(|value| value.parse().ok())
        .unwrap_or_default()
}

fn reconciliation_from_row(
    row: &sqlx::sqlite::SqliteRow,
) -> Result<LibraryReconciliation, LibraryError> {
    Ok(LibraryReconciliation {
        scan_id: row
            .try_get("scan_id")
            .map_err(|_| LibraryError::database())?,
        root_id: row
            .try_get("root_id")
            .map_err(|_| LibraryError::database())?,
        status: row
            .try_get("status")
            .map_err(|_| LibraryError::database())?,
        started_at: row
            .try_get("started_at")
            .map_err(|_| LibraryError::database())?,
        completed_at: row
            .try_get("completed_at")
            .map_err(|_| LibraryError::database())?,
        total: row.try_get("total").map_err(|_| LibraryError::database())?,
        processed: row
            .try_get("processed")
            .map_err(|_| LibraryError::database())?,
        changed: row
            .try_get("changed")
            .map_err(|_| LibraryError::database())?,
        unchanged: row
            .try_get("unchanged")
            .map_err(|_| LibraryError::database())?,
        renamed: row
            .try_get("renamed")
            .map_err(|_| LibraryError::database())?,
        unavailable: row
            .try_get("unavailable")
            .map_err(|_| LibraryError::database())?,
        failed: row
            .try_get("failed")
            .map_err(|_| LibraryError::database())?,
        error_summary: row
            .try_get("error_summary")
            .map_err(|_| LibraryError::database())?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn fixture() -> (SqlitePool, ReconciliationService, tempfile::TempDir, i64) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open fixture database");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate fixture database");
        let directory = tempfile::tempdir().expect("create fixture root");
        let root_path = directory
            .path()
            .canonicalize()
            .expect("canonical fixture root")
            .to_string_lossy()
            .into_owned();
        let root_id: i64 = sqlx::query_scalar(
            "INSERT INTO library_roots (path, canonical_path) VALUES (?, ?) RETURNING id",
        )
        .bind(&root_path)
        .bind(&root_path)
        .fetch_one(&pool)
        .await
        .expect("insert fixture root");
        let service = ReconciliationService::new(pool.clone());
        (pool, service, directory, root_id)
    }

    fn write_wav(path: &Path, seed: u8) {
        let samples = vec![seed; 64];
        let data_length = samples.len() as u32;
        let riff_length = 36 + data_length;
        let mut bytes = Vec::with_capacity(44 + samples.len());
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&riff_length.to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&8_000_u32.to_le_bytes());
        bytes.extend_from_slice(&8_000_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&8_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_length.to_le_bytes());
        bytes.extend_from_slice(&samples);
        std::fs::write(path, bytes).expect("write wav fixture");
    }

    fn observation(root: &Path, normalized_path: &str) -> ObservedFile {
        let path = root.join(normalized_path);
        let metadata = path.metadata().expect("read fixture metadata");
        let modified_at_ns = metadata
            .modified()
            .expect("read modified time")
            .duration_since(UNIX_EPOCH)
            .expect("modified after epoch")
            .as_nanos()
            .min(i64::MAX as u128) as i64;
        ObservedFile {
            normalized_path: normalized_path.to_owned(),
            file_size: metadata.len() as i64,
            modified_at_ns,
        }
    }

    async fn completed_scan(pool: &SqlitePool, root_id: i64, observations: &[ObservedFile]) -> i64 {
        let scan_id: i64 = sqlx::query_scalar(
            "INSERT INTO library_scans (root_id, status, completed_at, discovered)
             VALUES (?, 'completed', CURRENT_TIMESTAMP, ?) RETURNING id",
        )
        .bind(root_id)
        .bind(observations.len() as i64)
        .fetch_one(pool)
        .await
        .expect("insert completed scan");
        for observed in observations {
            sqlx::query(
                "INSERT INTO library_scan_files
                 (scan_id, normalized_path, file_size, modified_at_ns)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(scan_id)
            .bind(&observed.normalized_path)
            .bind(observed.file_size)
            .bind(observed.modified_at_ns)
            .execute(pool)
            .await
            .expect("insert observed file");
        }
        scan_id
    }

    async fn insert_existing_song(pool: &SqlitePool, root_id: i64, observed: &ObservedFile) {
        insert_native_song(
            pool,
            root_id,
            "existing",
            &observed.normalized_path,
            observed,
            "existing-fingerprint",
            "available",
        )
        .await;
    }

    async fn insert_native_song(
        pool: &SqlitePool,
        root_id: i64,
        id: &str,
        normalized_path: &str,
        observed: &ObservedFile,
        quick_fingerprint: &str,
        availability: &str,
    ) {
        sqlx::query(
            "INSERT INTO songs (
               id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
               trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
               favorRating, dateAdded, visualsPath, root_id, normalized_path, file_size,
               modified_at_ns, quick_fingerprint, availability, metadata_version
             ) VALUES (
               ?, ?, ?, 'Old title', 'Old album', 'Old artist', '', 0, 0, '', '',
               0, 0, 'pcm', '', '8000', 0, 42, 2, 'original-date', 'old-art',
               ?, ?, ?, ?, ?, ?, ?
             )",
        )
        .bind(id)
        .bind(format!("/library/{normalized_path}"))
        .bind(
            Path::new(normalized_path)
                .file_name()
                .expect("song file name")
                .to_string_lossy()
                .into_owned(),
        )
        .bind(root_id)
        .bind(normalized_path)
        .bind(observed.file_size)
        .bind(observed.modified_at_ns)
        .bind(quick_fingerprint)
        .bind(availability)
        .bind(METADATA_VERSION)
        .execute(pool)
        .await
        .expect("insert native song");
    }

    async fn prepare_snapshot(
        service: &ReconciliationService,
        scan_id: i64,
        root_id: i64,
        root: &Path,
        total: i64,
    ) {
        service
            .create(scan_id, root_id, total)
            .await
            .expect("create reconciliation");
        service
            .run_prepare(
                scan_id,
                root.to_path_buf(),
                Arc::new(AtomicBool::new(false)),
                None,
            )
            .await;
        assert_eq!(
            service
                .get(scan_id)
                .await
                .expect("read ready reconciliation")
                .status,
            "ready"
        );
    }

    async fn insert_staged_metadata(pool: &SqlitePool, scan_id: i64) {
        sqlx::query(
            "INSERT INTO library_scan_metadata (
               scan_id, normalized_path, candidate_id, quick_fingerprint, path, file,
               title, album, artist, genre, bpm, compilation, date, encoder,
               track_total, track_number, codec, duration, sample_rate, side, visuals_path
             ) VALUES (
               ?, 'track.wav', 'candidate', 'fingerprint', '/library/track.wav', 'track.wav',
               'Track', '', '', '', 0, 0, '', '', 0, 0, 'pcm', '', '8000', 0, ''
             )",
        )
        .bind(scan_id)
        .execute(pool)
        .await
        .expect("insert staged metadata");
    }

    #[test]
    fn quick_fingerprint_is_deterministic_and_samples_both_ends() {
        let directory = tempfile::tempdir().expect("create fingerprint fixture");
        let path = directory.path().join("track.bin");
        let mut bytes = vec![7_u8; FINGERPRINT_SAMPLE_SIZE * 2 + 1];
        std::fs::write(&path, &bytes).expect("write fingerprint fixture");
        let original = quick_fingerprint(&path, bytes.len() as i64).expect("fingerprint file");
        assert_eq!(
            quick_fingerprint(&path, bytes.len() as i64).expect("repeat fingerprint"),
            original
        );

        bytes[0] = 8;
        std::fs::write(&path, &bytes).expect("change first sample");
        let changed_first =
            quick_fingerprint(&path, bytes.len() as i64).expect("fingerprint first");
        assert_ne!(changed_first, original);

        bytes[0] = 7;
        *bytes.last_mut().expect("last byte") = 8;
        std::fs::write(&path, &bytes).expect("change last sample");
        let changed_last = quick_fingerprint(&path, bytes.len() as i64).expect("fingerprint last");
        assert_ne!(changed_last, original);
    }

    #[test]
    fn observed_paths_reject_traversal_symlinks_and_changed_files() {
        let directory = tempfile::tempdir().expect("create path fixture");
        let root = directory.path().canonicalize().expect("canonical root");
        write_wav(&root.join("track.wav"), 1);
        let valid = observation(&root, "track.wav");
        assert_eq!(
            resolve_observed_file(&root, &valid).expect("resolve valid file"),
            root.join("track.wav")
        );

        let traversal = ObservedFile {
            normalized_path: "../outside.wav".to_owned(),
            ..valid.clone()
        };
        assert!(resolve_observed_file(&root, &traversal).is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("track.wav"), root.join("linked.wav"))
                .expect("create file symlink");
            let linked = ObservedFile {
                normalized_path: "linked.wav".to_owned(),
                ..valid.clone()
            };
            assert!(resolve_observed_file(&root, &linked).is_err());
        }

        std::fs::write(root.join("track.wav"), [1, 2, 3]).expect("change observed file");
        assert!(resolve_observed_file(&root, &valid).is_err());
    }

    #[test]
    fn preparation_crosses_worker_and_write_bounds_without_mutating_songs() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let root = directory.path().canonicalize().expect("canonical root");
            let mut observations = Vec::new();
            for index in 0..=WRITE_BATCH_SIZE * 2 {
                let normalized_path = format!("track-{index:03}.wav");
                write_wav(&root.join(&normalized_path), index as u8);
                observations.push(observation(&root, &normalized_path));
            }
            write_wav(&root.join("unchanged.wav"), 255);
            let unchanged = observation(&root, "unchanged.wav");
            observations.push(unchanged.clone());
            let scan_id = completed_scan(&pool, root_id, &observations).await;
            insert_existing_song(&pool, root_id, &unchanged).await;
            service
                .create(scan_id, root_id, observations.len() as i64)
                .await
                .expect("create reconciliation");

            service
                .run_prepare(scan_id, root, Arc::new(AtomicBool::new(false)), None)
                .await;

            let ready = service.get(scan_id).await.expect("read preparation");
            let staged: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM library_scan_metadata WHERE scan_id = ?")
                    .bind(scan_id)
                    .fetch_one(&pool)
                    .await
                    .expect("count staged metadata");
            let songs: (i64, i64, String, String) = sqlx::query_as(
                "SELECT COUNT(*), SUM(startTime), MIN(dateAdded), MIN(title) FROM songs",
            )
            .fetch_one(&pool)
            .await
            .expect("inspect untouched songs");

            assert_eq!(ready.status, "ready");
            assert_eq!(ready.processed, 202);
            assert_eq!(ready.changed, 201);
            assert_eq!(ready.unchanged, 1);
            assert_eq!(staged, 201);
            assert_eq!(
                songs,
                (1, 42, "original-date".to_owned(), "Old title".to_owned())
            );
        });
    }

    #[test]
    fn metadata_failure_removes_partial_staging_and_never_becomes_ready() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let root = directory.path().canonicalize().expect("canonical root");
            write_wav(&root.join("good.wav"), 1);
            std::fs::write(root.join("invalid.wav"), [1, 2, 3]).expect("write invalid audio");
            let observations = vec![
                observation(&root, "good.wav"),
                observation(&root, "invalid.wav"),
            ];
            let scan_id = completed_scan(&pool, root_id, &observations).await;
            service
                .create(scan_id, root_id, observations.len() as i64)
                .await
                .expect("create reconciliation");

            service
                .run_prepare(scan_id, root, Arc::new(AtomicBool::new(false)), None)
                .await;

            let failed = service.get(scan_id).await.expect("read failed preparation");
            let staged: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM library_scan_metadata WHERE scan_id = ?")
                    .bind(scan_id)
                    .fetch_one(&pool)
                    .await
                    .expect("count cleared staging");
            assert_eq!(failed.status, "failed");
            assert_eq!(failed.failed, 1);
            assert_eq!(staged, 0);
        });
    }

    #[test]
    fn cancellation_and_startup_recovery_clear_sensitive_staging() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let root = directory.path().canonicalize().expect("canonical root");
            write_wav(&root.join("track.wav"), 1);
            let observations = vec![observation(&root, "track.wav")];
            let cancelled_scan = completed_scan(&pool, root_id, &observations).await;
            service
                .create(cancelled_scan, root_id, 1)
                .await
                .expect("create cancelled reconciliation");
            service
                .run_prepare(
                    cancelled_scan,
                    root.clone(),
                    Arc::new(AtomicBool::new(true)),
                    None,
                )
                .await;
            let cancelled = service
                .get(cancelled_scan)
                .await
                .expect("read cancelled preparation");
            assert_eq!(cancelled.status, "cancelled");
            assert_eq!(cancelled.failed, 0);

            let interrupted_scan = completed_scan(&pool, root_id, &observations).await;
            service
                .create(interrupted_scan, root_id, 1)
                .await
                .expect("create interrupted reconciliation");
            sqlx::query(
                "UPDATE library_reconciliations
                 SET status = 'preparing', processed = 1, changed = 1
                 WHERE scan_id = ?",
            )
            .bind(interrupted_scan)
            .execute(&pool)
            .await
            .expect("mark reconciliation preparing");
            insert_staged_metadata(&pool, interrupted_scan).await;

            service
                .recover_interrupted()
                .await
                .expect("recover preparation");

            let interrupted = service
                .get(interrupted_scan)
                .await
                .expect("read interrupted preparation");
            let staged: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM library_scan_metadata WHERE scan_id = ?")
                    .bind(interrupted_scan)
                    .fetch_one(&pool)
                    .await
                    .expect("count cleared interrupted staging");
            assert_eq!(interrupted.status, "interrupted");
            assert_eq!(staged, 0);
        });
    }

    #[test]
    fn reconciliation_constraints_and_scan_cascade_are_enforced() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let root = directory.path().canonicalize().expect("canonical root");
            write_wav(&root.join("track.wav"), 1);
            let observations = vec![observation(&root, "track.wav")];
            let scan_id = completed_scan(&pool, root_id, &observations).await;
            service
                .create(scan_id, root_id, 1)
                .await
                .expect("create reconciliation");
            let invalid = sqlx::query(
                "UPDATE library_reconciliations SET processed = 2, changed = 2 WHERE scan_id = ?",
            )
            .bind(scan_id)
            .execute(&pool)
            .await;
            assert!(invalid.is_err());

            sqlx::query(
                "UPDATE library_reconciliations
                 SET status = 'preparing', processed = 1, changed = 1
                 WHERE scan_id = ?",
            )
            .bind(scan_id)
            .execute(&pool)
            .await
            .expect("prepare staging owner");
            insert_staged_metadata(&pool, scan_id).await;
            sqlx::query("DELETE FROM library_scans WHERE id = ?")
                .bind(scan_id)
                .execute(&pool)
                .await
                .expect("delete scan generation");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM library_reconciliations")
                    .fetch_one(&pool)
                    .await
                    .expect("count reconciliations"),
                0
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM library_scan_metadata")
                    .fetch_one(&pool)
                    .await
                    .expect("count staged metadata"),
                0
            );
        });
    }

    #[test]
    fn only_the_latest_completed_scan_for_an_enabled_root_can_be_prepared() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let root = directory.path().canonicalize().expect("canonical root");
            write_wav(&root.join("track.wav"), 1);
            let observations = vec![observation(&root, "track.wav")];
            let older_scan = completed_scan(&pool, root_id, &observations).await;
            let latest_scan = completed_scan(&pool, root_id, &observations).await;

            assert_eq!(
                service
                    .load_scan_context(older_scan)
                    .await
                    .expect_err("reject stale completed scan")
                    .code,
                "library_scan_not_ready"
            );
            let context = service
                .load_scan_context(latest_scan)
                .await
                .expect("accept latest completed scan");
            assert_eq!(context.root_id, root_id);
            assert_eq!(context.root_path, root);
            assert_eq!(context.total, 1);

            sqlx::query("UPDATE library_roots SET enabled = 0 WHERE id = ?")
                .bind(root_id)
                .execute(&pool)
                .await
                .expect("disable root");
            assert_eq!(
                service
                    .load_scan_context(latest_scan)
                    .await
                    .expect_err("reject disabled root")
                    .code,
                "library_scan_not_ready"
            );
        });
    }

    #[test]
    fn atomic_apply_preserves_identity_and_user_state_across_updates_and_renames() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let root = directory.path().canonicalize().expect("canonical root");
            for (name, seed) in [
                ("changed.wav", 1),
                ("renamed-new.wav", 2),
                ("new.wav", 3),
                ("returned.wav", 4),
            ] {
                write_wav(&root.join(name), seed);
            }
            let observations = [
                observation(&root, "changed.wav"),
                observation(&root, "renamed-new.wav"),
                observation(&root, "new.wav"),
                observation(&root, "returned.wav"),
            ];
            let scan_id = completed_scan(&pool, root_id, &observations).await;

            let mut previous_changed = observations[0].clone();
            previous_changed.modified_at_ns -= 1;
            insert_native_song(
                &pool,
                root_id,
                "same-id",
                "changed.wav",
                &previous_changed,
                "old-changed-fingerprint",
                "available",
            )
            .await;
            let rename_fingerprint =
                quick_fingerprint(&root.join("renamed-new.wav"), observations[1].file_size)
                    .expect("fingerprint rename fixture");
            insert_native_song(
                &pool,
                root_id,
                "rename-id",
                "renamed-old.wav",
                &observations[1],
                &rename_fingerprint,
                "available",
            )
            .await;
            insert_native_song(
                &pool,
                root_id,
                "returned-id",
                "returned.wav",
                &observations[3],
                "returned-fingerprint",
                "unavailable",
            )
            .await;
            insert_native_song(
                &pool,
                root_id,
                "missing-id",
                "missing.wav",
                &observations[0],
                "missing-fingerprint",
                "available",
            )
            .await;

            prepare_snapshot(&service, scan_id, root_id, &root, observations.len() as i64).await;
            let completed = service.apply(scan_id).await.expect("apply ready snapshot");

            let rows: Vec<(String, String, String, i64, i64, String)> = sqlx::query_as(
                "SELECT id, normalized_path, availability, startTime, favorRating, dateAdded
                 FROM songs WHERE root_id = ? ORDER BY id",
            )
            .bind(root_id)
            .fetch_all(&pool)
            .await
            .expect("read reconciled songs");
            let scan_counts: (i64, i64) =
                sqlx::query_as("SELECT updated, unavailable FROM library_scans WHERE id = ?")
                    .bind(scan_id)
                    .fetch_one(&pool)
                    .await
                    .expect("read scan counters");
            let last_scan_at: Option<String> =
                sqlx::query_scalar("SELECT last_scan_at FROM library_roots WHERE id = ?")
                    .bind(root_id)
                    .fetch_one(&pool)
                    .await
                    .expect("read root scan time");

            assert_eq!(completed.status, "completed");
            assert_eq!(completed.changed, 3);
            assert_eq!(completed.unchanged, 1);
            assert_eq!(completed.renamed, 1);
            assert_eq!(completed.unavailable, 1);
            assert_eq!(scan_counts, (3, 1));
            assert!(last_scan_at.is_some());
            assert_eq!(rows.len(), 5);
            assert!(rows.contains(&(
                "same-id".to_owned(),
                "changed.wav".to_owned(),
                "available".to_owned(),
                42,
                2,
                "original-date".to_owned(),
            )));
            assert!(rows.contains(&(
                "rename-id".to_owned(),
                "renamed-new.wav".to_owned(),
                "available".to_owned(),
                42,
                2,
                "original-date".to_owned(),
            )));
            assert!(rows.iter().any(|row| {
                row.1 == "new.wav" && row.2 == "available" && row.3 == 0 && row.4 == 0
            }));
            assert!(rows.iter().any(|row| {
                row.0 == "returned-id" && row.2 == "available" && row.3 == 42 && row.4 == 2
            }));
            assert!(rows
                .iter()
                .any(|row| row.0 == "missing-id" && row.2 == "unavailable"));
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM library_scan_metadata WHERE scan_id = ?",
                )
                .bind(scan_id)
                .fetch_one(&pool)
                .await
                .expect("count cleared metadata"),
                0
            );
        });
    }

    #[test]
    fn ambiguous_rename_fingerprints_create_a_new_identity() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let root = directory.path().canonicalize().expect("canonical root");
            write_wav(&root.join("candidate.wav"), 9);
            let observed = observation(&root, "candidate.wav");
            let fingerprint = quick_fingerprint(&root.join("candidate.wav"), observed.file_size)
                .expect("fingerprint candidate");
            let scan_id = completed_scan(&pool, root_id, std::slice::from_ref(&observed)).await;
            insert_native_song(
                &pool,
                root_id,
                "old-a",
                "old-a.wav",
                &observed,
                &fingerprint,
                "available",
            )
            .await;
            insert_native_song(
                &pool,
                root_id,
                "old-b",
                "old-b.wav",
                &observed,
                &fingerprint,
                "available",
            )
            .await;
            prepare_snapshot(&service, scan_id, root_id, &root, 1).await;

            let completed = service
                .apply(scan_id)
                .await
                .expect("apply ambiguous snapshot");
            let rows: Vec<(String, String)> =
                sqlx::query_as("SELECT normalized_path, availability FROM songs WHERE root_id = ?")
                    .bind(root_id)
                    .fetch_all(&pool)
                    .await
                    .expect("read ambiguous results");

            assert_eq!(completed.renamed, 0);
            assert_eq!(completed.unavailable, 2);
            assert_eq!(rows.len(), 3);
            assert!(rows.contains(&("candidate.wav".to_owned(), "available".to_owned())));
            assert!(rows.contains(&("old-a.wav".to_owned(), "unavailable".to_owned())));
            assert!(rows.contains(&("old-b.wav".to_owned(), "unavailable".to_owned())));
        });
    }

    #[test]
    fn failure_after_upsert_rolls_back_the_entire_catalog_commit() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let root = directory.path().canonicalize().expect("canonical root");
            write_wav(&root.join("changed.wav"), 1);
            let observed = observation(&root, "changed.wav");
            let scan_id = completed_scan(&pool, root_id, std::slice::from_ref(&observed)).await;
            let mut previous = observed.clone();
            previous.modified_at_ns -= 1;
            insert_native_song(
                &pool,
                root_id,
                "same-id",
                "changed.wav",
                &previous,
                "old-fingerprint",
                "available",
            )
            .await;
            insert_native_song(
                &pool,
                root_id,
                "missing-id",
                "missing.wav",
                &observed,
                "missing-fingerprint",
                "available",
            )
            .await;
            prepare_snapshot(&service, scan_id, root_id, &root, 1).await;
            service.mark_applying(scan_id).await.expect("mark applying");
            let before: Vec<(String, String, String, String)> = sqlx::query_as(
                "SELECT id, title, normalized_path, availability FROM songs ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .expect("read catalog before failure");
            let revision_before: i64 =
                sqlx::query_scalar("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read revision before failure");

            let error = service
                .apply_ready_with_hook(scan_id, || Err(LibraryError::database()))
                .await
                .expect_err("inject failure after upsert");
            assert_eq!(error.code, "database_unavailable");

            let after: Vec<(String, String, String, String)> = sqlx::query_as(
                "SELECT id, title, normalized_path, availability FROM songs ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .expect("read catalog after rollback");
            let revision_after: i64 =
                sqlx::query_scalar("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read revision after rollback");
            let root_scan_at: Option<String> =
                sqlx::query_scalar("SELECT last_scan_at FROM library_roots WHERE id = ?")
                    .bind(root_id)
                    .fetch_one(&pool)
                    .await
                    .expect("read rolled back root state");
            let scan_counts: (i64, i64) =
                sqlx::query_as("SELECT updated, unavailable FROM library_scans WHERE id = ?")
                    .bind(scan_id)
                    .fetch_one(&pool)
                    .await
                    .expect("read rolled back scan state");

            assert_eq!(after, before);
            assert_eq!(revision_after, revision_before);
            assert!(root_scan_at.is_none());
            assert_eq!(scan_counts, (0, 0));
            service
                .finish_apply_failure(scan_id)
                .await
                .expect("settle failed apply");
            assert_eq!(
                service
                    .get(scan_id)
                    .await
                    .expect("read settled failure")
                    .status,
                "failed"
            );
        });
    }

    #[test]
    fn stale_snapshots_and_candidate_id_collisions_fail_closed() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let root = directory.path().canonicalize().expect("canonical root");
            write_wav(&root.join("track.wav"), 1);
            let observed = observation(&root, "track.wav");
            let stale_scan = completed_scan(&pool, root_id, std::slice::from_ref(&observed)).await;
            prepare_snapshot(&service, stale_scan, root_id, &root, 1).await;
            completed_scan(&pool, root_id, std::slice::from_ref(&observed)).await;
            assert_eq!(
                service
                    .apply(stale_scan)
                    .await
                    .expect_err("reject stale ready snapshot")
                    .code,
                "library_scan_not_ready"
            );
            assert_eq!(
                service
                    .get(stale_scan)
                    .await
                    .expect("read stale reconciliation")
                    .status,
                "failed"
            );

            let other_root: i64 = sqlx::query_scalar(
                "INSERT INTO library_roots (path, canonical_path) VALUES (?, ?) RETURNING id",
            )
            .bind("/unrelated")
            .bind("/unrelated")
            .fetch_one(&pool)
            .await
            .expect("insert unrelated root");
            let collision_scan =
                completed_scan(&pool, root_id, std::slice::from_ref(&observed)).await;
            prepare_snapshot(&service, collision_scan, root_id, &root, 1).await;
            let candidate_id = hash_string(&root.join("track.wav").to_string_lossy());
            insert_native_song(
                &pool,
                other_root,
                &candidate_id,
                "unrelated.wav",
                &observed,
                "unrelated-fingerprint",
                "available",
            )
            .await;

            assert_eq!(
                service
                    .apply(collision_scan)
                    .await
                    .expect_err("reject candidate identity collision")
                    .code,
                "library_identity_collision"
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
                    .fetch_one(&pool)
                    .await
                    .expect("count collision-safe songs"),
                1
            );
        });
    }
}

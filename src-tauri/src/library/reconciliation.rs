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
        let context = self.load_scan_context(scan_id).await?;
        let reconciliation = self.create(scan_id, context.root_id, context.total).await?;
        let cancelled = Arc::new(AtomicBool::new(false));
        self.active
            .lock()
            .map_err(|_| LibraryError::database())?
            .insert(scan_id, cancelled.clone());

        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            service
                .run_prepare(scan_id, context.root_path, cancelled, Some(app))
                .await;
            if let Ok(mut active) = service.active.lock() {
                active.remove(&scan_id);
            }
        });
        Ok(reconciliation)
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
        let row = sqlx::query(
            "SELECT scan_id, root_id, status, started_at, completed_at, total,
                    processed, changed, unchanged, renamed, unavailable, failed, error_summary
             FROM library_reconciliations WHERE scan_id = ?",
        )
        .bind(scan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?
        .ok_or_else(LibraryError::reconciliation_not_found)?;
        reconciliation_from_row(&row)
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
             WHERE scan_id = ? AND status IN ('pending', 'preparing')",
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

    async fn insert_existing_song(
        pool: &SqlitePool,
        root_id: i64,
        scan_id: i64,
        observed: &ObservedFile,
    ) {
        sqlx::query(
            "INSERT INTO songs (
               id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
               trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
               favorRating, dateAdded, visualsPath, root_id, normalized_path, file_size,
               modified_at_ns, quick_fingerprint, availability, last_seen_scan_id, metadata_version
             ) VALUES (
               'existing', '/library/unchanged.wav', 'unchanged.wav', 'Existing', '', '', '',
               0, 0, '', '', 0, 0, 'pcm', '', '8000', 0, 42, 2, 'original-date', '',
               ?, ?, ?, ?, 'existing-fingerprint', 'available', ?, ?
             )",
        )
        .bind(root_id)
        .bind(&observed.normalized_path)
        .bind(observed.file_size)
        .bind(observed.modified_at_ns)
        .bind(scan_id)
        .bind(METADATA_VERSION)
        .execute(pool)
        .await
        .expect("insert existing song");
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
            insert_existing_song(&pool, root_id, scan_id, &unchanged).await;
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
                (1, 42, "original-date".to_owned(), "Existing".to_owned())
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
}

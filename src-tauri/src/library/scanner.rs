use super::query::LibraryError;
use serde::Serialize;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::Emitter;
use tokio::sync::mpsc;

const DISCOVERY_BUFFER: usize = 256;
const WRITE_BATCH_SIZE: usize = 100;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const PROGRESS_EVENT: &str = "library-scan-progress";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScan {
    pub id: i64,
    pub root_id: i64,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub discovered: i64,
    pub updated: i64,
    pub unavailable: i64,
    pub failed: i64,
    pub error_summary: Option<String>,
}

#[derive(Clone, Debug)]
struct FileObservation {
    normalized_path: String,
    file_size: i64,
    modified_at_ns: i64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct DiscoveryOutcome {
    cancelled: bool,
    failed: i64,
}

#[derive(Clone)]
pub struct ScannerService {
    active: Arc<Mutex<HashMap<i64, Arc<AtomicBool>>>>,
    pool: SqlitePool,
}

impl ScannerService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
            pool,
        }
    }

    pub async fn recover_interrupted(&self) -> Result<(), LibraryError> {
        sqlx::query(
            "UPDATE library_scans
             SET status = 'interrupted', completed_at = CURRENT_TIMESTAMP,
                 error_summary = 'The application stopped before discovery completed.'
             WHERE status IN ('pending', 'running')",
        )
        .execute(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?;
        Ok(())
    }

    pub async fn start(
        &self,
        root_id: i64,
        app: tauri::AppHandle,
    ) -> Result<LibraryScan, LibraryError> {
        let root_path: String = sqlx::query_scalar(
            "SELECT canonical_path FROM library_roots WHERE id = ? AND enabled = 1",
        )
        .bind(root_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?
        .ok_or_else(LibraryError::root_not_found)?;
        let scan = self.create_scan(root_id).await?;
        let cancelled = Arc::new(AtomicBool::new(false));
        self.active
            .lock()
            .map_err(|_| LibraryError::database())?
            .insert(scan.id, cancelled.clone());

        let service = self.clone();
        let scan_id = scan.id;
        tauri::async_runtime::spawn(async move {
            service
                .run(scan_id, PathBuf::from(root_path), cancelled, Some(app))
                .await;
            if let Ok(mut active) = service.active.lock() {
                active.remove(&scan_id);
            }
        });
        Ok(scan)
    }

    pub async fn cancel(&self, scan_id: i64) -> Result<LibraryScan, LibraryError> {
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

    pub async fn get(&self, scan_id: i64) -> Result<LibraryScan, LibraryError> {
        let row = sqlx::query(
            "SELECT id, root_id, status, started_at, completed_at, discovered,
                    updated, unavailable, failed, error_summary
             FROM library_scans WHERE id = ?",
        )
        .bind(scan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?
        .ok_or_else(LibraryError::scan_not_found)?;
        scan_from_row(&row)
    }

    async fn create_scan(&self, root_id: i64) -> Result<LibraryScan, LibraryError> {
        let row = sqlx::query(
            "INSERT INTO library_scans (root_id, status) VALUES (?, 'pending')
             RETURNING id, root_id, status, started_at, completed_at, discovered,
                       updated, unavailable, failed, error_summary",
        )
        .bind(root_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|database| database.is_unique_violation())
            {
                LibraryError::scan_in_progress()
            } else {
                LibraryError::database()
            }
        })?;
        scan_from_row(&row)
    }

    async fn run(
        &self,
        scan_id: i64,
        root: PathBuf,
        cancelled: Arc<AtomicBool>,
        app: Option<tauri::AppHandle>,
    ) {
        if self.mark_running(scan_id).await.is_err() {
            return;
        }
        let (sender, mut receiver) = mpsc::channel(DISCOVERY_BUFFER);
        let producer_cancelled = cancelled.clone();
        let producer_root = root.clone();
        let producer = tauri::async_runtime::spawn_blocking(move || {
            discover_files(&producer_root, sender, &producer_cancelled)
        });

        let mut discovered = 0_i64;
        let mut batch = Vec::with_capacity(WRITE_BATCH_SIZE);
        let mut last_progress = Instant::now();
        while let Some(observation) = receiver.recv().await {
            batch.push(observation);
            if batch.len() == WRITE_BATCH_SIZE {
                if self.write_batch(scan_id, &batch).await.is_err() {
                    cancelled.store(true, Ordering::Release);
                    let _ = self.finish(scan_id, "failed", discovered, 1).await;
                    return;
                }
                discovered += batch.len() as i64;
                batch.clear();
                self.emit_progress(&app, scan_id, discovered, 0, &mut last_progress)
                    .await;
            }
        }
        if !batch.is_empty() {
            if self.write_batch(scan_id, &batch).await.is_err() {
                cancelled.store(true, Ordering::Release);
                let _ = self.finish(scan_id, "failed", discovered, 1).await;
                return;
            }
            discovered += batch.len() as i64;
        }

        let outcome = match producer.await {
            Ok(outcome) => outcome,
            Err(_) => DiscoveryOutcome {
                cancelled: false,
                failed: 1,
            },
        };
        let status = if outcome.cancelled || cancelled.load(Ordering::Acquire) {
            "cancelled"
        } else if outcome.failed > 0 {
            "failed"
        } else {
            "completed"
        };
        let _ = self
            .finish(scan_id, status, discovered, outcome.failed)
            .await;
        if let Ok(scan) = self.get(scan_id).await {
            if let Some(app) = app {
                let _ = app.emit(PROGRESS_EVENT, scan);
            }
        }
    }

    async fn mark_running(&self, scan_id: i64) -> Result<(), LibraryError> {
        sqlx::query(
            "UPDATE library_scans SET status = 'running' WHERE id = ? AND status = 'pending'",
        )
        .bind(scan_id)
        .execute(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?;
        Ok(())
    }

    async fn write_batch(
        &self,
        scan_id: i64,
        batch: &[FileObservation],
    ) -> Result<(), LibraryError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LibraryError::database())?;
        let mut query = QueryBuilder::<Sqlite>::new(
            "INSERT INTO library_scan_files
             (scan_id, normalized_path, file_size, modified_at_ns) ",
        );
        query.push_values(batch, |mut row, observation| {
            row.push_bind(scan_id)
                .push_bind(&observation.normalized_path)
                .push_bind(observation.file_size)
                .push_bind(observation.modified_at_ns);
        });
        query
            .build()
            .execute(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
        sqlx::query("UPDATE library_scans SET discovered = discovered + ? WHERE id = ?")
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

    async fn finish(
        &self,
        scan_id: i64,
        status: &str,
        discovered: i64,
        failed: i64,
    ) -> Result<(), LibraryError> {
        let error_summary = match status {
            "failed" => Some("Jukebox could not discover files in this library folder."),
            "cancelled" => Some("Library discovery was cancelled."),
            _ if failed > 0 => Some("Some folders or files could not be inspected."),
            _ => None,
        };
        sqlx::query(
            "UPDATE library_scans
             SET status = ?, completed_at = CURRENT_TIMESTAMP, discovered = ?, failed = ?,
                 error_summary = ?
             WHERE id = ?",
        )
        .bind(status)
        .bind(discovered)
        .bind(failed)
        .bind(error_summary)
        .bind(scan_id)
        .execute(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?;
        Ok(())
    }

    async fn emit_progress(
        &self,
        app: &Option<tauri::AppHandle>,
        scan_id: i64,
        discovered: i64,
        failed: i64,
        last_progress: &mut Instant,
    ) {
        if last_progress.elapsed() < PROGRESS_INTERVAL {
            return;
        }
        if let Some(app) = app {
            if let Ok(mut scan) = self.get(scan_id).await {
                scan.discovered = discovered;
                scan.failed = failed;
                let _ = app.emit(PROGRESS_EVENT, scan);
            }
        }
        *last_progress = Instant::now();
    }
}

fn discover_files(
    root: &Path,
    sender: mpsc::Sender<FileObservation>,
    cancelled: &AtomicBool,
) -> DiscoveryOutcome {
    let mut outcome = DiscoveryOutcome::default();
    let root_entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => {
            outcome.failed = 1;
            return outcome;
        }
    };
    let mut directories = vec![root_entries];
    while let Some(entries) = directories.last_mut() {
        if cancelled.load(Ordering::Acquire) {
            outcome.cancelled = true;
            break;
        }
        let entry = match entries.next() {
            Some(entry) => entry,
            None => {
                directories.pop();
                continue;
            }
        };
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                outcome.failed += 1;
                continue;
            }
        };
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => {
                outcome.failed += 1;
                continue;
            }
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            match std::fs::read_dir(path) {
                Ok(entries) => directories.push(entries),
                Err(_) => outcome.failed += 1,
            }
            continue;
        }
        if !file_type.is_file() || !is_audio_file(&path) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                outcome.failed += 1;
                continue;
            }
        };
        let modified_at_ns = match metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        {
            Some(modified) => modified.as_nanos().min(i64::MAX as u128) as i64,
            None => {
                outcome.failed += 1;
                continue;
            }
        };
        let Some(normalized_path) = normalized_relative_path(root, &path) else {
            outcome.failed += 1;
            continue;
        };
        let observation = FileObservation {
            normalized_path,
            file_size: metadata.len().min(i64::MAX as u64) as i64,
            modified_at_ns,
        };
        if sender.blocking_send(observation).is_err() {
            outcome.cancelled = cancelled.load(Ordering::Acquire);
            return outcome;
        }
    }
    outcome
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "mp3" | "ogg" | "aac" | "flac" | "wav" | "m4a"
            )
        })
}

fn normalized_relative_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let normalized = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    (!normalized.is_empty()).then_some(normalized)
}

fn scan_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<LibraryScan, LibraryError> {
    Ok(LibraryScan {
        id: row.try_get("id").map_err(|_| LibraryError::database())?,
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
        discovered: row
            .try_get("discovered")
            .map_err(|_| LibraryError::database())?,
        updated: row
            .try_get("updated")
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

    async fn fixture() -> (SqlitePool, ScannerService, tempfile::TempDir, i64) {
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
        let path = directory.path().to_string_lossy().into_owned();
        let root_id: i64 = sqlx::query_scalar(
            "INSERT INTO library_roots (path, canonical_path) VALUES (?, ?) RETURNING id",
        )
        .bind(&path)
        .bind(&path)
        .fetch_one(&pool)
        .await
        .expect("insert fixture root");
        let service = ScannerService::new(pool.clone());
        (pool, service, directory, root_id)
    }

    #[test]
    fn discovery_filters_hidden_unsupported_and_symlinked_entries() {
        tauri::async_runtime::block_on(async {
            let directory = tempfile::tempdir().expect("create discovery root");
            let album = directory.path().join("Album");
            std::fs::create_dir(&album).expect("create album");
            std::fs::write(album.join("one.FLAC"), [1]).expect("write audio file");
            std::fs::write(album.join("notes.txt"), [2]).expect("write unsupported file");
            std::fs::write(directory.path().join("two.mp3"), [3]).expect("write root audio");
            std::fs::write(directory.path().join(".hidden.m4a"), [4]).expect("write hidden file");
            #[cfg(unix)]
            std::os::unix::fs::symlink(&album, directory.path().join("album-link"))
                .expect("create symlink");

            let (sender, mut receiver) = mpsc::channel(DISCOVERY_BUFFER);
            let root = directory.path().to_path_buf();
            let cancelled = Arc::new(AtomicBool::new(false));
            let producer_cancelled = cancelled.clone();
            let producer = tauri::async_runtime::spawn_blocking(move || {
                discover_files(&root, sender, &producer_cancelled)
            });
            let mut paths = Vec::new();
            while let Some(observation) = receiver.recv().await {
                paths.push(observation.normalized_path);
            }
            paths.sort();
            let outcome = producer.await.expect("join discovery");

            assert_eq!(outcome, DiscoveryOutcome::default());
            assert_eq!(paths, vec!["Album/one.FLAC", "two.mp3"]);
        });
    }

    #[test]
    fn discovery_honors_cancellation_before_traversal() {
        let directory = tempfile::tempdir().expect("create discovery root");
        std::fs::write(directory.path().join("one.flac"), [1]).expect("write audio file");
        let (sender, mut receiver) = mpsc::channel(DISCOVERY_BUFFER);
        let cancelled = AtomicBool::new(true);

        let outcome = discover_files(directory.path(), sender, &cancelled);

        assert!(outcome.cancelled);
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn completed_discovery_stages_a_bounded_snapshot_without_mutating_songs() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            let nested = directory.path().join("nested");
            std::fs::create_dir(&nested).expect("create nested folder");
            for index in 0..513 {
                std::fs::write(nested.join(format!("track-{index}.flac")), [index as u8])
                    .expect("write audio file");
            }
            let scan = service.create_scan(root_id).await.expect("create scan");

            service
                .run(
                    scan.id,
                    directory.path().to_path_buf(),
                    Arc::new(AtomicBool::new(false)),
                    None,
                )
                .await;

            let finished = service.get(scan.id).await.expect("read finished scan");
            let staged: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM library_scan_files WHERE scan_id = ?")
                    .bind(scan.id)
                    .fetch_one(&pool)
                    .await
                    .expect("count staged files");
            let songs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM songs")
                .fetch_one(&pool)
                .await
                .expect("count untouched songs");

            assert_eq!(finished.status, "completed");
            assert_eq!(finished.discovered, 513);
            assert_eq!(finished.failed, 0);
            assert_eq!(staged, 513);
            assert_eq!(songs, 0);

            sqlx::query("DELETE FROM library_scans WHERE id = ?")
                .bind(scan.id)
                .execute(&pool)
                .await
                .expect("delete completed scan");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM library_scan_files")
                    .fetch_one(&pool)
                    .await
                    .expect("confirm staged rows cascade"),
                0
            );
        });
    }

    #[test]
    fn active_scan_uniqueness_and_startup_recovery_are_enforced() {
        tauri::async_runtime::block_on(async {
            let (pool, service, _directory, root_id) = fixture().await;
            let first = service
                .create_scan(root_id)
                .await
                .expect("create first scan");
            assert_eq!(
                service
                    .create_scan(root_id)
                    .await
                    .expect_err("reject second active scan")
                    .code,
                "library_scan_in_progress"
            );
            let other_root: i64 = sqlx::query_scalar(
                "INSERT INTO library_roots (path, canonical_path) VALUES (?, ?) RETURNING id",
            )
            .bind("/independent")
            .bind("/independent")
            .fetch_one(&pool)
            .await
            .expect("insert independent root");
            service
                .create_scan(other_root)
                .await
                .expect("allow independent active scan");

            service
                .recover_interrupted()
                .await
                .expect("recover interrupted scans");
            let recovered = service.get(first.id).await.expect("read recovered scan");
            let active: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM library_scans WHERE status IN ('pending', 'running')",
            )
            .fetch_one(&pool)
            .await
            .expect("count active scans");

            assert_eq!(recovered.status, "interrupted");
            assert!(recovered.completed_at.is_some());
            assert_eq!(active, 0);
        });
    }

    #[test]
    fn staging_failure_settles_the_scan_as_failed() {
        tauri::async_runtime::block_on(async {
            let (pool, service, directory, root_id) = fixture().await;
            std::fs::write(directory.path().join("one.flac"), [1]).expect("write audio file");
            let scan = service.create_scan(root_id).await.expect("create scan");
            sqlx::query("DROP TABLE library_scan_files")
                .execute(&pool)
                .await
                .expect("inject staging failure");

            service
                .run(
                    scan.id,
                    directory.path().to_path_buf(),
                    Arc::new(AtomicBool::new(false)),
                    None,
                )
                .await;

            let finished = service.get(scan.id).await.expect("read failed scan");
            assert_eq!(finished.status, "failed");
            assert!(finished.completed_at.is_some());
        });
    }
}

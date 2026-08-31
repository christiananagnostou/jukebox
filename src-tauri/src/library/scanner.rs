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
use tokio::sync::Notify;
use tokio::time::Instant as TokioInstant;

const DISCOVERY_BUFFER: usize = 256;
const WRITE_BATCH_SIZE: usize = 100;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const DISCOVERY_STALL_TIMEOUT: Duration = Duration::from_secs(30);
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

enum DiscoveryMessage {
    Observation(FileObservation),
    Activity,
    Complete(DiscoveryOutcome),
}

trait DiscoverySource: Send + Sync {
    fn discover(
        &self,
        root: &Path,
        sender: &mpsc::Sender<DiscoveryMessage>,
        cancelled: &AtomicBool,
    ) -> DiscoveryOutcome;
}

struct FilesystemDiscovery;

impl DiscoverySource for FilesystemDiscovery {
    fn discover(
        &self,
        root: &Path,
        sender: &mpsc::Sender<DiscoveryMessage>,
        cancelled: &AtomicBool,
    ) -> DiscoveryOutcome {
        discover_files(root, sender, cancelled)
    }
}

#[derive(Clone)]
struct ScanCancellation {
    flag: Arc<AtomicBool>,
    wake: Arc<Notify>,
}

#[derive(Clone)]
pub struct ScannerService {
    active: Arc<Mutex<HashMap<i64, ScanCancellation>>>,
    discovery: Arc<dyn DiscoverySource>,
    discovery_worker_available: Arc<AtomicBool>,
    stall_timeout: Duration,
    pool: SqlitePool,
}

pub(crate) struct ScanTask {
    pub scan: LibraryScan,
    root: PathBuf,
    cancelled: Arc<AtomicBool>,
    cancellation_wake: Arc<Notify>,
}

impl ScannerService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
            discovery: Arc::new(FilesystemDiscovery),
            discovery_worker_available: Arc::new(AtomicBool::new(true)),
            stall_timeout: DISCOVERY_STALL_TIMEOUT,
            pool,
        }
    }

    #[cfg(test)]
    fn with_discovery(
        pool: SqlitePool,
        discovery: Arc<dyn DiscoverySource>,
        stall_timeout: Duration,
    ) -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
            discovery,
            discovery_worker_available: Arc::new(AtomicBool::new(true)),
            stall_timeout,
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
        let task = self
            .begin(root_id, Arc::new(AtomicBool::new(false)))
            .await?;
        let scan = task.scan.clone();
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let _ = service.complete(task, Some(app)).await;
        });
        Ok(scan)
    }

    pub(crate) async fn begin(
        &self,
        root_id: i64,
        cancelled: Arc<AtomicBool>,
    ) -> Result<ScanTask, LibraryError> {
        let root_path: String = sqlx::query_scalar(
            "SELECT canonical_path FROM library_roots WHERE id = ? AND enabled = 1",
        )
        .bind(root_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| LibraryError::database())?
        .ok_or_else(LibraryError::root_not_found)?;
        let scan = self.create_scan(root_id).await?;
        let cancellation_wake = Arc::new(Notify::new());
        self.active
            .lock()
            .map_err(|_| LibraryError::database())?
            .insert(
                scan.id,
                ScanCancellation {
                    flag: cancelled.clone(),
                    wake: cancellation_wake.clone(),
                },
            );

        Ok(ScanTask {
            scan,
            root: PathBuf::from(root_path),
            cancelled,
            cancellation_wake,
        })
    }

    pub(crate) async fn complete(
        &self,
        task: ScanTask,
        app: Option<tauri::AppHandle>,
    ) -> Result<LibraryScan, LibraryError> {
        let scan_id = task.scan.id;
        self.run(
            scan_id,
            task.root,
            task.cancelled,
            task.cancellation_wake,
            app,
        )
        .await;
        if let Ok(mut active) = self.active.lock() {
            active.remove(&scan_id);
        }
        self.get(scan_id).await
    }

    pub async fn cancel(&self, scan_id: i64) -> Result<LibraryScan, LibraryError> {
        let cancelled = self
            .active
            .lock()
            .map_err(|_| LibraryError::database())?
            .get(&scan_id)
            .cloned();
        if let Some(cancellation) = cancelled {
            cancellation.flag.store(true, Ordering::Release);
            cancellation.wake.notify_one();
            self.finish(scan_id, "cancelled", 0).await?;
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
        cancellation_wake: Arc<Notify>,
        app: Option<tauri::AppHandle>,
    ) {
        if self.mark_running(scan_id).await.is_err() {
            return;
        }
        if self
            .discovery_worker_available
            .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            let _ = self.finish(scan_id, "failed", 1).await;
            return;
        }

        let (sender, mut receiver) = mpsc::channel(DISCOVERY_BUFFER);
        let producer_cancelled = cancelled.clone();
        let producer_root = root;
        let discovery = self.discovery.clone();
        let worker_available = self.discovery_worker_available.clone();
        let spawn_result = std::thread::Builder::new()
            .name("jukebox-library-discovery".to_owned())
            .spawn(move || {
                let outcome = discovery.discover(&producer_root, &sender, &producer_cancelled);
                let _ = sender.blocking_send(DiscoveryMessage::Complete(outcome));
                worker_available.store(true, Ordering::Release);
            });
        if spawn_result.is_err() {
            self.discovery_worker_available
                .store(true, Ordering::Release);
            let _ = self.finish(scan_id, "failed", 1).await;
            return;
        }

        let mut discovered = 0_i64;
        let mut batch = Vec::with_capacity(WRITE_BATCH_SIZE);
        let mut last_progress = Instant::now();
        let stall = tokio::time::sleep(self.stall_timeout);
        tokio::pin!(stall);
        let outcome = loop {
            tokio::select! {
                biased;
                _ = cancellation_wake.notified() => {
                    if cancelled.load(Ordering::Acquire) {
                        break DiscoveryOutcome { cancelled: true, failed: 0 };
                    }
                }
                _ = &mut stall => {
                    cancelled.store(true, Ordering::Release);
                    break DiscoveryOutcome { cancelled: false, failed: 1 };
                }
                message = receiver.recv() => {
                    stall.as_mut().reset(TokioInstant::now() + self.stall_timeout);
                    match message {
                        Some(DiscoveryMessage::Activity) => {}
                        Some(DiscoveryMessage::Observation(observation)) => {
                            batch.push(observation);
                            if batch.len() == WRITE_BATCH_SIZE {
                                if self.write_batch(scan_id, &batch).await.is_err() {
                                    cancelled.store(true, Ordering::Release);
                                    break DiscoveryOutcome { cancelled: false, failed: 1 };
                                }
                                discovered += batch.len() as i64;
                                batch.clear();
                                self.emit_progress(
                                    &app,
                                    scan_id,
                                    discovered,
                                    0,
                                    &mut last_progress,
                                )
                                .await;
                            }
                        }
                        Some(DiscoveryMessage::Complete(outcome)) => break outcome,
                        None => break DiscoveryOutcome { cancelled: false, failed: 1 },
                    }
                }
            }
        };
        drop(receiver);

        if !outcome.cancelled
            && outcome.failed == 0
            && !batch.is_empty()
            && self.write_batch(scan_id, &batch).await.is_err()
        {
            let _ = self.finish(scan_id, "failed", 1).await;
            return;
        }
        let status = if outcome.cancelled {
            "cancelled"
        } else if outcome.failed > 0 {
            "failed"
        } else if cancelled.load(Ordering::Acquire) {
            "cancelled"
        } else {
            "completed"
        };
        let _ = self.finish(scan_id, status, outcome.failed).await;
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
        let running = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
               SELECT 1 FROM library_scans WHERE id = ? AND status = 'running'
             )",
        )
        .bind(scan_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
        if !running {
            transaction
                .rollback()
                .await
                .map_err(|_| LibraryError::database())?;
            return Err(LibraryError::database());
        }
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

    async fn finish(&self, scan_id: i64, status: &str, failed: i64) -> Result<(), LibraryError> {
        let error_summary = match status {
            "failed" => Some("Jukebox could not discover files in this library folder."),
            "cancelled" => Some("Library discovery was cancelled."),
            _ if failed > 0 => Some("Some folders or files could not be inspected."),
            _ => None,
        };
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LibraryError::database())?;
        sqlx::query(
            "UPDATE library_scans
             SET status = ?, completed_at = CURRENT_TIMESTAMP, failed = ?, error_summary = ?
             WHERE id = ? AND status IN ('pending', 'running')",
        )
        .bind(status)
        .bind(failed)
        .bind(error_summary)
        .bind(scan_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
        if status != "completed" {
            let _ = sqlx::query("DELETE FROM library_scan_files WHERE scan_id = ?")
                .bind(scan_id)
                .execute(&mut *transaction)
                .await;
        }
        transaction
            .commit()
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
    sender: &mpsc::Sender<DiscoveryMessage>,
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
        let _ = sender.try_send(DiscoveryMessage::Activity);
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
        if sender
            .blocking_send(DiscoveryMessage::Observation(observation))
            .is_err()
        {
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
    use crate::playback_assets::PlaybackAssetServer;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::atomic::AtomicUsize;
    use std::sync::{mpsc as std_mpsc, Condvar};

    struct BlockingDiscovery {
        calls: Arc<AtomicUsize>,
        release: Arc<(Mutex<bool>, Condvar)>,
        started: std_mpsc::SyncSender<()>,
    }

    impl DiscoverySource for BlockingDiscovery {
        fn discover(
            &self,
            _root: &Path,
            _sender: &mpsc::Sender<DiscoveryMessage>,
            _cancelled: &AtomicBool,
        ) -> DiscoveryOutcome {
            self.calls.fetch_add(1, Ordering::AcqRel);
            let _ = self.started.send(());
            let (lock, wake) = &*self.release;
            let mut released = lock.lock().expect("lock blocked discovery");
            while !*released {
                released = wake.wait(released).expect("wait for discovery release");
            }
            DiscoveryOutcome::default()
        }
    }

    fn release_discovery(release: &Arc<(Mutex<bool>, Condvar)>) {
        let (lock, wake) = &**release;
        *lock.lock().expect("lock discovery release") = true;
        wake.notify_all();
    }

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
                let outcome = discover_files(&root, &sender, &producer_cancelled);
                let _ = sender.blocking_send(DiscoveryMessage::Complete(outcome));
            });
            let mut paths = Vec::new();
            let outcome = loop {
                match receiver.recv().await {
                    Some(DiscoveryMessage::Observation(observation)) => {
                        paths.push(observation.normalized_path)
                    }
                    Some(DiscoveryMessage::Activity) => {}
                    Some(DiscoveryMessage::Complete(outcome)) => break outcome,
                    None => panic!("discovery worker closed without an outcome"),
                }
            };
            paths.sort();
            producer.await.expect("join discovery");

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

        let outcome = discover_files(directory.path(), &sender, &cancelled);

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
                    Arc::new(Notify::new()),
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
                    Arc::new(Notify::new()),
                    None,
                )
                .await;

            let finished = service.get(scan.id).await.expect("read failed scan");
            assert_eq!(finished.status, "failed");
            assert!(finished.completed_at.is_some());
        });
    }

    #[test]
    fn cancellation_settles_without_waiting_for_a_blocked_worker_and_bounds_restarts() {
        tauri::async_runtime::block_on(async {
            let (pool, _, directory, root_id) = fixture().await;
            let (started_tx, started_rx) = std_mpsc::sync_channel(1);
            let calls = Arc::new(AtomicUsize::new(0));
            let release = Arc::new((Mutex::new(false), Condvar::new()));
            let service = ScannerService::with_discovery(
                pool.clone(),
                Arc::new(BlockingDiscovery {
                    calls: calls.clone(),
                    release: release.clone(),
                    started: started_tx,
                }),
                Duration::from_secs(5),
            );
            let cancelled = Arc::new(AtomicBool::new(false));
            let task = service
                .begin(root_id, cancelled)
                .await
                .expect("begin blocked discovery");
            let scan_id = task.scan.id;
            let completing_service = service.clone();
            let completion = tokio::spawn(async move {
                completing_service
                    .complete(task, None)
                    .await
                    .expect("settle cancelled discovery")
            });
            started_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("blocked discovery started");

            let playable = directory.path().join("playable.flac");
            std::fs::write(&playable, b"playable").expect("write playable track");
            let playback = PlaybackAssetServer::for_test(Duration::from_millis(250));
            tokio::time::timeout(
                Duration::from_millis(250),
                playback.verify_test_access(playable),
            )
            .await
            .expect("playback stayed responsive during blocked discovery")
            .expect("playback access succeeded during blocked discovery");

            let started = Instant::now();
            let cancelled_scan = service
                .cancel(scan_id)
                .await
                .expect("cancel blocked discovery");
            assert_eq!(cancelled_scan.status, "cancelled");
            assert!(started.elapsed() < Duration::from_millis(250));
            let completed = tokio::time::timeout(Duration::from_millis(250), completion)
                .await
                .expect("cancelled completion stayed bounded")
                .expect("join cancelled completion");
            assert_eq!(completed.status, "cancelled");

            let retry = service
                .begin(root_id, Arc::new(AtomicBool::new(false)))
                .await
                .expect("begin bounded retry");
            let retry =
                tokio::time::timeout(Duration::from_millis(250), service.complete(retry, None))
                    .await
                    .expect("bounded retry settled")
                    .expect("read bounded retry");
            assert_eq!(retry.status, "failed");
            assert_eq!(calls.load(Ordering::Acquire), 1);

            release_discovery(&release);
            tokio::time::sleep(Duration::from_millis(25)).await;
            assert_eq!(
                service
                    .get(scan_id)
                    .await
                    .expect("read cancelled scan after late worker")
                    .status,
                "cancelled"
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM library_scan_files WHERE scan_id = ?",
                )
                .bind(scan_id)
                .fetch_one(&pool)
                .await
                .expect("count cancelled staging"),
                0
            );
            drop(directory);
        });
    }

    #[test]
    fn stalled_discovery_times_out_without_publishing_late_state() {
        tauri::async_runtime::block_on(async {
            let (pool, _, directory, root_id) = fixture().await;
            let (started_tx, started_rx) = std_mpsc::sync_channel(1);
            let release = Arc::new((Mutex::new(false), Condvar::new()));
            let service = ScannerService::with_discovery(
                pool.clone(),
                Arc::new(BlockingDiscovery {
                    calls: Arc::new(AtomicUsize::new(0)),
                    release: release.clone(),
                    started: started_tx,
                }),
                Duration::from_millis(25),
            );
            let task = service
                .begin(root_id, Arc::new(AtomicBool::new(false)))
                .await
                .expect("begin timed discovery");
            let scan_id = task.scan.id;
            let completing_service = service.clone();
            let completion = tokio::spawn(async move {
                completing_service
                    .complete(task, None)
                    .await
                    .expect("settle timed discovery")
            });
            started_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("timed discovery started");
            let failed = tokio::time::timeout(Duration::from_millis(250), completion)
                .await
                .expect("discovery deadline stayed bounded")
                .expect("join timed discovery");
            assert_eq!(failed.status, "failed");

            let restarted = ScannerService::new(pool.clone());
            restarted
                .recover_interrupted()
                .await
                .expect("recover scans after restart");
            let restarted_task = restarted
                .begin(root_id, Arc::new(AtomicBool::new(false)))
                .await
                .expect("begin discovery after restart");
            let restarted_scan = tokio::time::timeout(
                Duration::from_millis(250),
                restarted.complete(restarted_task, None),
            )
            .await
            .expect("restart recovery stayed responsive")
            .expect("complete discovery after restart");
            assert_eq!(restarted_scan.status, "completed");

            release_discovery(&release);
            tokio::time::sleep(Duration::from_millis(25)).await;
            assert_eq!(
                service
                    .get(scan_id)
                    .await
                    .expect("read failed scan after late worker")
                    .status,
                "failed"
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM library_scan_files WHERE scan_id = ?",
                )
                .bind(scan_id)
                .fetch_one(&pool)
                .await
                .expect("count timed-out staging"),
                0
            );
            drop(directory);
        });
    }
}

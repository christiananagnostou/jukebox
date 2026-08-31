use super::{scanner, LibraryError, LibraryReconciliation, LibraryScan, LibraryState};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};

use crate::diagnostics::DiagnosticsState;

const REFRESH_PROGRESS_EVENT: &str = "library-refresh-progress";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRefresh {
    pub scan: LibraryScan,
    pub reconciliation: Option<LibraryReconciliation>,
    pub status: String,
}

#[derive(Clone)]
struct ActiveRefresh {
    cancelled: Arc<AtomicBool>,
    root_id: i64,
}

#[derive(Clone, Default)]
pub(super) struct ActiveRefreshes(Arc<Mutex<HashMap<i64, ActiveRefresh>>>);

impl LibraryState {
    pub async fn list_library_refreshes(&self) -> Result<Vec<LibraryRefresh>, LibraryError> {
        self.ensure_initialized().await?;
        let scan_ids = sqlx::query_scalar::<_, i64>(
            "SELECT MAX(scans.id)
             FROM library_scans AS scans
             JOIN library_refresh_runs AS refreshes ON refreshes.scan_id = scans.id
             GROUP BY scans.root_id ORDER BY scans.root_id",
        )
        .fetch_all(&self.repository.pool())
        .await
        .map_err(|_| LibraryError::database())?;
        let mut refreshes = Vec::with_capacity(scan_ids.len());
        for scan_id in scan_ids {
            refreshes.push(self.get_library_refresh(scan_id).await?);
        }
        Ok(refreshes)
    }

    pub async fn start_library_refresh(
        &self,
        root_id: i64,
        app: tauri::AppHandle,
    ) -> Result<LibraryRefresh, LibraryError> {
        self.ensure_initialized().await?;
        if self
            .active_refreshes
            .0
            .lock()
            .map_err(|_| LibraryError::database())?
            .values()
            .any(|refresh| refresh.root_id == root_id)
        {
            return Err(LibraryError::refresh_in_progress());
        }

        let cancelled = Arc::new(AtomicBool::new(false));
        let task = self.scanner.begin(root_id, cancelled.clone()).await?;
        let scan_id = task.scan.id;
        self.mark_library_refresh(scan_id).await?;
        let refresh = LibraryRefresh::new(task.scan.clone(), None, true);
        self.active_refreshes
            .0
            .lock()
            .map_err(|_| LibraryError::database())?
            .insert(
                scan_id,
                ActiveRefresh {
                    cancelled: cancelled.clone(),
                    root_id,
                },
            );

        let library = self.clone();
        let diagnostics = app
            .try_state::<DiagnosticsState>()
            .map(|state| state.inner().clone());
        if let Some(diagnostics) = &diagnostics {
            diagnostics.record_info(
                "library_refresh",
                "started",
                &format!("scan_id={scan_id} root_id={root_id}"),
            );
        }
        tauri::async_runtime::spawn(async move {
            let started = Instant::now();
            let result = library
                .complete_refresh(task, cancelled, Some(app.clone()))
                .await;
            match &result {
                Ok(refresh) => {
                    let detail = format!(
                        "scan_id={scan_id} root_id={root_id} status={} discovered={} updated={} unavailable={} failed={} elapsed_ms={}",
                        refresh.status,
                        refresh.scan.discovered,
                        refresh.scan.updated,
                        refresh.scan.unavailable,
                        refresh.scan.failed,
                        started.elapsed().as_millis()
                    );
                    if let Some(diagnostics) = &diagnostics {
                        if refresh.scan.failed > 0 || refresh.scan.error_summary.is_some() {
                            diagnostics.record_error(
                                "library_refresh",
                                "completed_with_errors",
                                &detail,
                            );
                        } else {
                            diagnostics.record_info("library_refresh", "completed", &detail);
                        }
                    }
                    let _ = app.emit(REFRESH_PROGRESS_EVENT, refresh);
                }
                Err(error) => {
                    if let Some(diagnostics) = &diagnostics {
                        diagnostics.record_error(
                            "library_refresh",
                            &error.code,
                            &format!(
                                "scan_id={scan_id} root_id={root_id} elapsed_ms={}",
                                started.elapsed().as_millis()
                            ),
                        );
                    }
                }
            }
            if let Ok(mut active) = library.active_refreshes.0.lock() {
                active.remove(&scan_id);
            }
        });
        Ok(refresh)
    }

    async fn mark_library_refresh(&self, scan_id: i64) -> Result<(), LibraryError> {
        sqlx::query("INSERT INTO library_refresh_runs (scan_id) VALUES (?)")
            .bind(scan_id)
            .execute(&self.repository.pool())
            .await
            .map_err(|_| LibraryError::database())?;
        Ok(())
    }

    pub async fn cancel_library_refresh(
        &self,
        scan_id: i64,
    ) -> Result<LibraryRefresh, LibraryError> {
        self.ensure_initialized().await?;
        if let Some(refresh) = self
            .active_refreshes
            .0
            .lock()
            .map_err(|_| LibraryError::database())?
            .get(&scan_id)
            .cloned()
        {
            refresh.cancelled.store(true, Ordering::Release);
        }
        let scan = self.scanner.cancel(scan_id).await?;
        if scan.status == "completed" && self.reconciliation.get_optional(scan_id).await?.is_some()
        {
            let _ = self.reconciliation.cancel(scan_id).await;
            self.reconciliation.settle_cancelled(scan_id).await?;
        }
        self.get_library_refresh(scan_id).await
    }

    pub async fn get_library_refresh(&self, scan_id: i64) -> Result<LibraryRefresh, LibraryError> {
        self.ensure_initialized().await?;
        let scan = self.scanner.get(scan_id).await?;
        let reconciliation = self.reconciliation.get_optional(scan_id).await?;
        let active = self
            .active_refreshes
            .0
            .lock()
            .map_err(|_| LibraryError::database())?
            .contains_key(&scan_id);
        Ok(LibraryRefresh::new(scan, reconciliation, active))
    }

    async fn complete_refresh(
        &self,
        task: scanner::ScanTask,
        cancelled: Arc<AtomicBool>,
        app: Option<tauri::AppHandle>,
    ) -> Result<LibraryRefresh, LibraryError> {
        let scan_id = task.scan.id;
        let scan = self.scanner.complete(task, app.clone()).await?;
        self.emit_refresh(&app, scan_id).await;
        if scan.status != "completed" {
            return Ok(LibraryRefresh::new(scan, None, false));
        }

        let preparation = self
            .reconciliation
            .begin(scan_id, cancelled.clone())
            .await?;
        if cancelled.load(Ordering::Acquire) {
            self.reconciliation.settle_cancelled(scan_id).await?;
            return self.get_library_refresh(scan_id).await;
        }
        let reconciliation = self
            .reconciliation
            .complete(preparation, app.clone())
            .await?;
        self.emit_refresh(&app, scan_id).await;
        if reconciliation.status != "ready" {
            return Ok(LibraryRefresh::new(scan, Some(reconciliation), false));
        }
        if cancelled.load(Ordering::Acquire) {
            self.reconciliation.settle_cancelled(scan_id).await?;
        } else {
            self.reconciliation.apply(scan_id).await?;
            self.collect_artwork_cache().await;
        }
        self.emit_refresh(&app, scan_id).await;
        self.get_library_refresh(scan_id).await
    }

    async fn emit_refresh(&self, app: &Option<tauri::AppHandle>, scan_id: i64) {
        if let Some(app) = app {
            if let Ok(refresh) = self.get_library_refresh(scan_id).await {
                let _ = app.emit(REFRESH_PROGRESS_EVENT, refresh);
            }
        }
    }
}

impl LibraryRefresh {
    fn new(scan: LibraryScan, reconciliation: Option<LibraryReconciliation>, active: bool) -> Self {
        let status = reconciliation
            .as_ref()
            .map(|reconciliation| reconciliation.status.clone())
            .unwrap_or_else(|| match scan.status.as_str() {
                "completed" if active => "preparing".to_owned(),
                "completed" => "awaiting_preparation".to_owned(),
                status => status.to_owned(),
            });
        Self {
            scan,
            reconciliation,
            status,
        }
    }
}

#[tauri::command]
pub async fn start_library_refresh(
    library: tauri::State<'_, LibraryState>,
    app: tauri::AppHandle,
    root_id: i64,
) -> Result<LibraryRefresh, LibraryError> {
    library.start_library_refresh(root_id, app).await
}

#[tauri::command]
pub async fn cancel_library_refresh(
    library: tauri::State<'_, LibraryState>,
    scan_id: i64,
) -> Result<LibraryRefresh, LibraryError> {
    library.cancel_library_refresh(scan_id).await
}

#[tauri::command]
pub async fn get_library_refresh(
    library: tauri::State<'_, LibraryState>,
    scan_id: i64,
) -> Result<LibraryRefresh, LibraryError> {
    library.get_library_refresh(scan_id).await
}

#[tauri::command]
pub async fn list_library_refreshes(
    library: tauri::State<'_, LibraryState>,
) -> Result<Vec<LibraryRefresh>, LibraryError> {
    library.list_library_refreshes().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::SqlitePool;
    use std::path::Path;

    fn write_wav(path: &Path, seed: u8, sample_count: usize) {
        let samples = vec![seed; sample_count];
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

    async fn refresh_fixture() -> (SqlitePool, LibraryState, tempfile::TempDir, i64) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open refresh fixture database");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate refresh fixture");
        let directory = tempfile::tempdir().expect("create refresh root");
        let root_path = directory
            .path()
            .canonicalize()
            .expect("canonical refresh root")
            .to_string_lossy()
            .into_owned();
        let root_id: i64 = sqlx::query_scalar(
            "INSERT INTO library_roots (path, canonical_path) VALUES (?, ?) RETURNING id",
        )
        .bind(&root_path)
        .bind(&root_path)
        .fetch_one(&pool)
        .await
        .expect("insert refresh root");
        (
            pool.clone(),
            LibraryState::from_pool(pool),
            directory,
            root_id,
        )
    }

    async fn run_refresh(
        state: &LibraryState,
        root_id: i64,
        cancelled: Arc<AtomicBool>,
    ) -> LibraryRefresh {
        let task = state
            .scanner
            .begin(root_id, cancelled.clone())
            .await
            .expect("begin refresh scan");
        state
            .mark_library_refresh(task.scan.id)
            .await
            .expect("mark refresh scan");
        state
            .complete_refresh(task, cancelled, None)
            .await
            .expect("complete refresh")
    }

    #[test]
    fn refresh_runs_discovery_preparation_and_atomic_apply_end_to_end() {
        tauri::async_runtime::block_on(async {
            let (pool, state, directory, root_id) = refresh_fixture().await;
            let track = directory.path().join("track.wav");
            write_wav(&track, 1, 64);

            let first = run_refresh(&state, root_id, Arc::new(AtomicBool::new(false))).await;
            let first_song: (String, i64, i64, String) = sqlx::query_as(
                "SELECT id, startTime, favorRating, dateAdded FROM songs WHERE root_id = ?",
            )
            .bind(root_id)
            .fetch_one(&pool)
            .await
            .expect("read first refreshed song");
            assert_eq!(first.status, "completed");
            assert_eq!(first.scan.updated, 1);
            assert_eq!(
                first.reconciliation.as_ref().map(|value| value.changed),
                Some(1)
            );

            sqlx::query(
                "UPDATE songs SET startTime = 23, favorRating = 2, dateAdded = 'preserved'",
            )
            .execute(&pool)
            .await
            .expect("set user song state");
            write_wav(&track, 2, 65);

            let second = run_refresh(&state, root_id, Arc::new(AtomicBool::new(false))).await;
            let second_song: (String, i64, i64, String) = sqlx::query_as(
                "SELECT id, startTime, favorRating, dateAdded FROM songs WHERE root_id = ?",
            )
            .bind(root_id)
            .fetch_one(&pool)
            .await
            .expect("read updated refreshed song");

            assert_eq!(second.status, "completed");
            assert_eq!(second.scan.updated, 1);
            assert_eq!(second_song.0, first_song.0);
            assert_eq!(second_song.1, 23);
            assert_eq!(second_song.2, 2);
            assert_eq!(second_song.3, "preserved");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
                    .fetch_one(&pool)
                    .await
                    .expect("count refreshed songs"),
                1
            );
        });
    }

    #[test]
    fn refresh_cancellation_and_metadata_failure_never_change_the_catalog() {
        tauri::async_runtime::block_on(async {
            let (pool, state, directory, root_id) = refresh_fixture().await;
            write_wav(&directory.path().join("cancelled.wav"), 1, 64);
            let cancelled = run_refresh(&state, root_id, Arc::new(AtomicBool::new(true))).await;
            assert_eq!(cancelled.status, "cancelled");
            assert!(cancelled.reconciliation.is_none());
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
                    .fetch_one(&pool)
                    .await
                    .expect("count songs after cancellation"),
                0
            );

            std::fs::remove_file(directory.path().join("cancelled.wav"))
                .expect("remove cancelled fixture");
            std::fs::write(directory.path().join("invalid.wav"), [1, 2, 3])
                .expect("write invalid audio");
            let failed = run_refresh(&state, root_id, Arc::new(AtomicBool::new(false))).await;
            assert_eq!(failed.status, "failed");
            assert_eq!(
                failed
                    .reconciliation
                    .as_ref()
                    .map(|reconciliation| reconciliation.failed),
                Some(1)
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
                    .fetch_one(&pool)
                    .await
                    .expect("count songs after metadata failure"),
                0
            );
        });
    }

    #[test]
    fn refresh_contract_serializes_stable_nested_status() {
        let refresh = LibraryRefresh::new(
            LibraryScan {
                id: 7,
                root_id: 3,
                status: "running".to_owned(),
                started_at: "now".to_owned(),
                completed_at: None,
                discovered: 2,
                updated: 0,
                unavailable: 0,
                failed: 0,
                error_summary: None,
            },
            None,
            true,
        );
        let value = serde_json::to_value(refresh).expect("serialize refresh");
        assert_eq!(value["status"], "running");
        assert_eq!(value["scan"]["rootId"], 3);
        assert!(value["reconciliation"].is_null());
    }

    #[test]
    fn latest_refresh_listing_returns_persisted_root_state() {
        tauri::async_runtime::block_on(async {
            let (_pool, state, directory, root_id) = refresh_fixture().await;
            assert!(state
                .list_library_refreshes()
                .await
                .expect("list empty refresh state")
                .is_empty());
            write_wav(&directory.path().join("track.wav"), 1, 64);
            let standalone = state
                .scanner
                .begin(root_id, Arc::new(AtomicBool::new(false)))
                .await
                .expect("begin standalone scan");
            state
                .scanner
                .complete(standalone, None)
                .await
                .expect("complete standalone scan");
            assert!(state
                .list_library_refreshes()
                .await
                .expect("ignore standalone scan")
                .is_empty());
            let completed = run_refresh(&state, root_id, Arc::new(AtomicBool::new(false))).await;
            let newer_standalone = state
                .scanner
                .begin(root_id, Arc::new(AtomicBool::new(false)))
                .await
                .expect("begin newer standalone scan");
            state
                .scanner
                .complete(newer_standalone, None)
                .await
                .expect("complete newer standalone scan");

            assert_eq!(
                state
                    .list_library_refreshes()
                    .await
                    .expect("list latest refresh"),
                vec![completed]
            );
        });
    }
}

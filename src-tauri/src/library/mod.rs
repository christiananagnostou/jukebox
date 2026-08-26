mod query;
mod repository;
mod roots;
mod scanner;

pub use query::{LibraryError, TrackQuery, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE};
pub use repository::{LibraryRepository, TrackPage, TrackSummary};
pub use roots::LibraryRoot;
pub use scanner::LibraryScan;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tokio::sync::OnceCell;

#[derive(Clone)]
pub struct LibraryState {
    initialized: Arc<OnceCell<Result<(), LibraryError>>>,
    repository: LibraryRepository,
    scanner: scanner::ScannerService,
}

impl LibraryState {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_config_dir()
            .map_err(|_| "Could not resolve the Jukebox data directory.".to_owned())?;
        std::fs::create_dir_all(&directory)
            .map_err(|_| "Could not prepare the Jukebox data directory.".to_owned())?;
        let path = directory.join("library.db");
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .busy_timeout(Duration::from_secs(5));
        let pool = open_pool(options)?;
        Ok(Self::from_pool(pool))
    }

    pub(crate) fn from_pool(pool: SqlitePool) -> Self {
        Self {
            initialized: Arc::new(OnceCell::new()),
            repository: LibraryRepository::new(pool.clone()),
            scanner: scanner::ScannerService::new(pool),
        }
    }

    pub(crate) fn pool(&self) -> SqlitePool {
        self.repository.pool()
    }

    pub async fn query_tracks(&self, query: TrackQuery) -> Result<TrackPage, LibraryError> {
        self.ensure_initialized().await?;
        self.repository.query_tracks(query).await
    }

    pub async fn add_library_root(&self, path: String) -> Result<LibraryRoot, LibraryError> {
        self.ensure_initialized().await?;
        let root = tauri::async_runtime::spawn_blocking(move || {
            let path = std::path::PathBuf::from(path);
            roots::canonicalize_library_root(&path)
        })
        .await
        .map_err(|_| LibraryError::invalid_root("The selected library folder is unavailable."))??;
        roots::add_library_root(&self.repository.pool(), root).await
    }

    pub async fn list_library_roots(&self) -> Result<Vec<LibraryRoot>, LibraryError> {
        self.ensure_initialized().await?;
        roots::list_library_roots(&self.repository.pool()).await
    }

    pub async fn set_library_root_enabled(
        &self,
        id: i64,
        enabled: bool,
    ) -> Result<LibraryRoot, LibraryError> {
        self.ensure_initialized().await?;
        roots::set_library_root_enabled(&self.repository.pool(), id, enabled).await
    }

    pub async fn start_library_scan(
        &self,
        root_id: i64,
        app: tauri::AppHandle,
    ) -> Result<LibraryScan, LibraryError> {
        self.ensure_initialized().await?;
        self.scanner.start(root_id, app).await
    }

    pub async fn cancel_library_scan(&self, scan_id: i64) -> Result<LibraryScan, LibraryError> {
        self.ensure_initialized().await?;
        self.scanner.cancel(scan_id).await
    }

    pub async fn get_library_scan(&self, scan_id: i64) -> Result<LibraryScan, LibraryError> {
        self.ensure_initialized().await?;
        self.scanner.get(scan_id).await
    }

    async fn ensure_initialized(&self) -> Result<(), LibraryError> {
        self.initialized
            .get_or_init(|| async {
                self.repository.initialize_schema().await?;
                self.scanner.recover_interrupted().await
            })
            .await
            .clone()
    }
}

fn open_pool(options: SqliteConnectOptions) -> Result<SqlitePool, String> {
    tauri::async_runtime::block_on(
        SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options),
    )
    .map_err(|_| "Could not open the Jukebox library database.".to_owned())
}

#[tauri::command]
pub async fn query_tracks(
    library: tauri::State<'_, LibraryState>,
    query: TrackQuery,
) -> Result<TrackPage, LibraryError> {
    library.query_tracks(query).await
}

#[tauri::command]
pub async fn add_library_root(
    library: tauri::State<'_, LibraryState>,
    path: String,
) -> Result<LibraryRoot, LibraryError> {
    library.add_library_root(path).await
}

#[tauri::command]
pub async fn list_library_roots(
    library: tauri::State<'_, LibraryState>,
) -> Result<Vec<LibraryRoot>, LibraryError> {
    library.list_library_roots().await
}

#[tauri::command]
pub async fn set_library_root_enabled(
    library: tauri::State<'_, LibraryState>,
    id: i64,
    enabled: bool,
) -> Result<LibraryRoot, LibraryError> {
    library.set_library_root_enabled(id, enabled).await
}

#[tauri::command]
pub async fn start_library_scan(
    library: tauri::State<'_, LibraryState>,
    app: tauri::AppHandle,
    root_id: i64,
) -> Result<LibraryScan, LibraryError> {
    library.start_library_scan(root_id, app).await
}

#[tauri::command]
pub async fn cancel_library_scan(
    library: tauri::State<'_, LibraryState>,
    scan_id: i64,
) -> Result<LibraryScan, LibraryError> {
    library.cancel_library_scan(scan_id).await
}

#[tauri::command]
pub async fn get_library_scan(
    library: tauri::State<'_, LibraryState>,
    scan_id: i64,
) -> Result<LibraryScan, LibraryError> {
    library.get_library_scan(scan_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_library_state_initializes_a_new_database_once() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open fixture database");
            let state = LibraryState::from_pool(pool.clone());

            let first = state
                .query_tracks(TrackQuery::default())
                .await
                .expect("initialize and query catalog");
            let second = state
                .query_tracks(TrackQuery::default())
                .await
                .expect("reuse initialized catalog");

            assert_eq!(first.total, 0);
            assert_eq!(second.total, 0);
            let revision_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM catalog_meta")
                .fetch_one(&pool)
                .await
                .expect("inspect initialized schema");
            assert_eq!(revision_rows, 1);
        });
    }

    #[test]
    fn pool_opening_enters_the_tauri_runtime() {
        let directory = tempfile::tempdir().expect("create fixture directory");
        let options = SqliteConnectOptions::new()
            .filename(directory.path().join("library.db"))
            .create_if_missing(true);

        let pool = open_pool(options).expect("open pool outside a caller Tokio context");
        tauri::async_runtime::block_on(async {
            let value: i64 = sqlx::query_scalar("SELECT 1")
                .fetch_one(&pool)
                .await
                .expect("query opened pool");
            assert_eq!(value, 1);
            pool.close().await;
        });
    }
}

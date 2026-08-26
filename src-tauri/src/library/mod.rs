mod query;
mod repository;

pub use query::{LibraryError, TrackQuery, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE};
pub use repository::{LibraryRepository, TrackPage, TrackSummary};

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
            repository: LibraryRepository::new(pool),
        }
    }

    pub(crate) fn pool(&self) -> SqlitePool {
        self.repository.pool()
    }

    pub async fn query_tracks(&self, query: TrackQuery) -> Result<TrackPage, LibraryError> {
        self.initialized
            .get_or_init(|| self.repository.initialize_schema())
            .await
            .clone()?;
        self.repository.query_tracks(query).await
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

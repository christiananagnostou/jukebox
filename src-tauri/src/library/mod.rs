mod query;
mod repository;

pub use query::{LibraryError, TrackQuery, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE};
pub use repository::{LibraryRepository, TrackPage, TrackSummary};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::time::Duration;
use tauri::Manager;

#[tauri::command]
pub async fn query_tracks(
    app_handle: tauri::AppHandle,
    query: TrackQuery,
) -> Result<TrackPage, LibraryError> {
    let path = app_handle
        .path()
        .app_config_dir()
        .map_err(|_| LibraryError::database())?
        .join("library.db");
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .map_err(|_| LibraryError::database())?;
    let result = LibraryRepository::new(pool.clone())
        .query_tracks(query)
        .await;
    pool.close().await;
    result
}

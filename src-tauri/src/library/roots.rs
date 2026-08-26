use super::query::LibraryError;
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    pub id: i64,
    pub path: String,
    pub enabled: bool,
    pub watch_status: String,
    pub created_at: String,
    pub last_scan_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CanonicalLibraryRoot {
    display_path: String,
    canonical_path: String,
}

pub(crate) fn canonicalize_library_root(path: &Path) -> Result<CanonicalLibraryRoot, LibraryError> {
    if path.as_os_str().is_empty() {
        return Err(LibraryError::invalid_root(
            "Choose a folder to add to the music library.",
        ));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| LibraryError::invalid_root("The selected library folder is unavailable."))?;
    if !canonical.is_dir() {
        return Err(LibraryError::invalid_root(
            "The selected library location must be a folder.",
        ));
    }

    Ok(CanonicalLibraryRoot {
        display_path: path.to_string_lossy().into_owned(),
        canonical_path: canonical.to_string_lossy().into_owned(),
    })
}

pub(crate) async fn add_library_root(
    pool: &SqlitePool,
    root: CanonicalLibraryRoot,
) -> Result<LibraryRoot, LibraryError> {
    let row = sqlx::query(
        "INSERT INTO library_roots (path, canonical_path)
         VALUES (?, ?)
         ON CONFLICT(canonical_path) DO UPDATE SET
           path = excluded.path, enabled = 1, watch_status = 'inactive'
         RETURNING id, path, enabled, watch_status, created_at, last_scan_at",
    )
    .bind(root.display_path)
    .bind(root.canonical_path)
    .fetch_one(pool)
    .await
    .map_err(|_| LibraryError::database())?;

    root_from_row(&row)
}

pub(crate) async fn list_library_roots(
    pool: &SqlitePool,
) -> Result<Vec<LibraryRoot>, LibraryError> {
    sqlx::query(
        "SELECT id, path, enabled, watch_status, created_at, last_scan_at
         FROM library_roots ORDER BY created_at, id",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| LibraryError::database())?
    .iter()
    .map(root_from_row)
    .collect()
}

pub(crate) async fn get_library_root(
    pool: &SqlitePool,
    id: i64,
) -> Result<LibraryRoot, LibraryError> {
    let row = sqlx::query(
        "SELECT id, path, enabled, watch_status, created_at, last_scan_at
         FROM library_roots WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|_| LibraryError::database())?
    .ok_or_else(LibraryError::root_not_found)?;
    root_from_row(&row)
}

pub(crate) async fn set_library_root_enabled(
    pool: &SqlitePool,
    id: i64,
    enabled: bool,
) -> Result<LibraryRoot, LibraryError> {
    let row = sqlx::query(
        "UPDATE library_roots
         SET enabled = ?, watch_status = 'inactive'
         WHERE id = ?
         RETURNING id, path, enabled, watch_status, created_at, last_scan_at",
    )
    .bind(enabled)
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|_| LibraryError::database())?
    .ok_or_else(LibraryError::root_not_found)?;

    root_from_row(&row)
}

fn root_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<LibraryRoot, LibraryError> {
    Ok(LibraryRoot {
        id: row.try_get("id").map_err(|_| LibraryError::database())?,
        path: row.try_get("path").map_err(|_| LibraryError::database())?,
        enabled: row
            .try_get::<i64, _>("enabled")
            .map_err(|_| LibraryError::database())?
            != 0,
        watch_status: row
            .try_get("watch_status")
            .map_err(|_| LibraryError::database())?,
        created_at: row
            .try_get("created_at")
            .map_err(|_| LibraryError::database())?,
        last_scan_at: row
            .try_get("last_scan_at")
            .map_err(|_| LibraryError::database())?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn repository() -> (SqlitePool, tempfile::TempDir) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open fixture database");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate fixture database");
        (pool, tempfile::tempdir().expect("create library root"))
    }

    #[test]
    fn roots_are_canonical_unique_and_reenabled_when_added_again() {
        tauri::async_runtime::block_on(async {
            let (pool, directory) = repository().await;
            let first = add_library_root(
                &pool,
                canonicalize_library_root(directory.path()).expect("canonicalize root"),
            )
            .await
            .expect("add root");
            set_library_root_enabled(&pool, first.id, false)
                .await
                .expect("disable root");
            let second = add_library_root(
                &pool,
                canonicalize_library_root(directory.path()).expect("canonicalize root again"),
            )
            .await
            .expect("re-add root");
            let roots = list_library_roots(&pool).await.expect("list roots");

            assert_eq!(first.id, second.id);
            assert!(second.enabled);
            assert_eq!(roots, vec![second]);
        });
    }

    #[test]
    fn roots_reject_files_missing_locations_and_unknown_ids() {
        tauri::async_runtime::block_on(async {
            let (pool, directory) = repository().await;
            let file = directory.path().join("track.flac");
            std::fs::write(&file, []).expect("create fixture file");

            assert_eq!(
                canonicalize_library_root(&file)
                    .expect_err("reject file")
                    .code,
                "invalid_library_root"
            );
            assert_eq!(
                canonicalize_library_root(&directory.path().join("missing"))
                    .expect_err("reject missing folder")
                    .code,
                "invalid_library_root"
            );
            assert_eq!(
                set_library_root_enabled(&pool, 999, false)
                    .await
                    .expect_err("reject unknown root")
                    .code,
                "library_root_not_found"
            );
        });
    }
}

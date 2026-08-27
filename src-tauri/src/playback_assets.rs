use crate::library::LibraryState;
use crate::DiagnosticsState;
use sqlx::{Row, SqlitePool};
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_TRACK_ID_BYTES: usize = 128;
const PLAYBACK_ASSET_ERROR: &str = "That track is not available for playback.";

fn valid_track_id(track_id: &str) -> bool {
    !track_id.is_empty()
        && track_id.len() <= MAX_TRACK_ID_BYTES
        && track_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

async fn resolve_playback_asset(pool: &SqlitePool, track_id: &str) -> Result<PathBuf, String> {
    if !valid_track_id(track_id) {
        return Err(PLAYBACK_ASSET_ERROR.to_owned());
    }

    let row = sqlx::query(
        "SELECT songs.path, songs.root_id, roots.canonical_path, roots.enabled
         FROM songs
         LEFT JOIN library_roots AS roots ON roots.id = songs.root_id
         WHERE songs.id = ? AND songs.availability = 'available'",
    )
    .bind(track_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| PLAYBACK_ASSET_ERROR.to_owned())?
    .ok_or_else(|| PLAYBACK_ASSET_ERROR.to_owned())?;

    let track_path: String = row
        .try_get("path")
        .map_err(|_| PLAYBACK_ASSET_ERROR.to_owned())?;
    let root_id: Option<i64> = row
        .try_get("root_id")
        .map_err(|_| PLAYBACK_ASSET_ERROR.to_owned())?;
    let track = canonical_file(Path::new(&track_path))?;

    if root_id.is_none() {
        return Ok(track);
    }

    let enabled: Option<i64> = row
        .try_get("enabled")
        .map_err(|_| PLAYBACK_ASSET_ERROR.to_owned())?;
    if enabled != Some(1) {
        return Err(PLAYBACK_ASSET_ERROR.to_owned());
    }
    let root: Option<String> = row
        .try_get("canonical_path")
        .map_err(|_| PLAYBACK_ASSET_ERROR.to_owned())?;
    let root = root.ok_or_else(|| PLAYBACK_ASSET_ERROR.to_owned())?;
    let root = std::fs::canonicalize(root).map_err(|_| PLAYBACK_ASSET_ERROR.to_owned())?;
    if track.starts_with(root) {
        Ok(track)
    } else {
        Err(PLAYBACK_ASSET_ERROR.to_owned())
    }
}

fn canonical_file(path: &Path) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(path).map_err(|_| PLAYBACK_ASSET_ERROR.to_owned())?;
    if path.is_file() {
        Ok(path)
    } else {
        Err(PLAYBACK_ASSET_ERROR.to_owned())
    }
}

#[tauri::command]
pub async fn authorize_playback_asset(
    app: tauri::AppHandle,
    library: tauri::State<'_, LibraryState>,
    diagnostics: tauri::State<'_, DiagnosticsState>,
    track_id: String,
) -> Result<String, String> {
    let path = resolve_playback_asset(&library.pool(), &track_id)
        .await
        .inspect_err(|_| {
            diagnostics.record_error("playback_asset", "resolution_failed", "");
        })?;
    let scope = app.asset_protocol_scope();
    scope.allow_file(&path).map_err(|_| {
        diagnostics.record_error("playback_asset", "scope_update_failed", "");
        "Jukebox could not authorize that track for playback.".to_owned()
    })?;
    if !scope.is_allowed(&path) {
        diagnostics.record_error("playback_asset", "scope_verification_failed", "");
        return Err("Jukebox could not authorize that track for playback.".to_owned());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn repository() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open playback asset database");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate playback asset database");
        pool
    }

    async fn insert_track(pool: &SqlitePool, id: &str, path: &Path, root_id: Option<i64>) {
        sqlx::query(
            "INSERT INTO songs (
                id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
                trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
                favorRating, dateAdded, visualsPath, root_id, availability
             ) VALUES (?, ?, 'track.flac', 'Track', '', '', '', 0, 0, '', '', 0, 0, 'flac',
                       '0:00:01.000', '44100', 0, 0, 0, '2026-08-27', '', ?, 'available')",
        )
        .bind(id)
        .bind(path.to_string_lossy().as_ref())
        .bind(root_id)
        .execute(pool)
        .await
        .expect("insert playback asset track");
    }

    async fn insert_root(pool: &SqlitePool, path: &Path, enabled: bool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO library_roots (path, canonical_path, enabled)
             VALUES (?, ?, ?) RETURNING id",
        )
        .bind(path.to_string_lossy().as_ref())
        .bind(path.to_string_lossy().as_ref())
        .bind(enabled)
        .fetch_one(pool)
        .await
        .expect("insert playback asset root")
    }

    #[test]
    fn authorizes_only_files_owned_by_enabled_roots() {
        tauri::async_runtime::block_on(async {
            let pool = repository().await;
            let directory = tempfile::tempdir().expect("create playback asset fixture");
            let root = directory.path().join("library");
            let outside = directory.path().join("outside");
            std::fs::create_dir_all(&root).expect("create library root");
            std::fs::create_dir_all(&outside).expect("create outside directory");
            let allowed = root.join("allowed.flac");
            let escaped = outside.join("escaped.flac");
            std::fs::write(&allowed, b"allowed").expect("write allowed track");
            std::fs::write(&escaped, b"escaped").expect("write escaped track");
            let root_id = insert_root(&pool, &root, true).await;
            insert_track(&pool, "allowed", &allowed, Some(root_id)).await;
            insert_track(&pool, "escaped", &escaped, Some(root_id)).await;

            assert_eq!(
                resolve_playback_asset(&pool, "allowed")
                    .await
                    .expect("authorize owned track"),
                std::fs::canonicalize(&allowed).expect("canonical allowed track")
            );
            assert_eq!(
                resolve_playback_asset(&pool, "escaped")
                    .await
                    .expect_err("reject escaped track"),
                PLAYBACK_ASSET_ERROR
            );

            sqlx::query("UPDATE library_roots SET enabled = 0 WHERE id = ?")
                .bind(root_id)
                .execute(&pool)
                .await
                .expect("disable root");
            assert_eq!(
                resolve_playback_asset(&pool, "allowed")
                    .await
                    .expect_err("reject disabled root"),
                PLAYBACK_ASSET_ERROR
            );
        });
    }

    #[test]
    fn authorizes_exact_rootless_catalog_files_and_redacts_failures() {
        tauri::async_runtime::block_on(async {
            let pool = repository().await;
            let directory = tempfile::tempdir().expect("create explicit playback fixture");
            let explicit = directory.path().join("explicit.flac");
            std::fs::write(&explicit, b"explicit").expect("write explicit track");
            insert_track(&pool, "explicit", &explicit, None).await;
            insert_track(
                &pool,
                "missing",
                &directory.path().join("private-name.flac"),
                None,
            )
            .await;

            assert_eq!(
                resolve_playback_asset(&pool, "explicit")
                    .await
                    .expect("authorize explicit track"),
                std::fs::canonicalize(&explicit).expect("canonical explicit track")
            );
            let rejected_ids = vec![
                "missing".to_owned(),
                "../missing".to_owned(),
                String::new(),
                "x".repeat(MAX_TRACK_ID_BYTES + 1),
            ];
            for track_id in rejected_ids {
                let error = resolve_playback_asset(&pool, &track_id)
                    .await
                    .expect_err("reject unavailable track");
                assert_eq!(error, PLAYBACK_ASSET_ERROR);
                assert!(!error.contains(directory.path().to_string_lossy().as_ref()));
            }
        });
    }
}

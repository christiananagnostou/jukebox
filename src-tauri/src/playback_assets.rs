use crate::library::LibraryState;
use crate::remote_access::{stream_file, ApiError};
use crate::DiagnosticsState;
use axum::extract::{Path as AxumPath, State};
use axum::http::header::RANGE;
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use sqlx::{Row, SqlitePool};
use std::fmt::Write;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

const MAX_TRACK_ID_BYTES: usize = 128;
const PLAYBACK_ASSET_ERROR: &str = "That track is not available for playback.";
const PLAYBACK_ACCESS_ERROR: &str =
    "Music folder access is required. Reconnect the folder in Settings.";
const PLAYBACK_SERVER_ERROR: &str = "Jukebox could not start its local playback server.";
const MAX_PLAYBACK_ACCESS_PROBES: usize = 2;
const PLAYBACK_ACCESS_QUEUE_TIMEOUT: Duration = Duration::from_millis(100);
const PLAYBACK_ACCESS_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
struct PlaybackHttpState {
    pool: SqlitePool,
    token: String,
}

pub struct PlaybackAssetServer {
    access_probe_slots: Arc<Semaphore>,
    access_probe_timeout: Duration,
    base_url: String,
    token: String,
}

impl PlaybackAssetServer {
    pub async fn start(pool: SqlitePool, diagnostics: DiagnosticsState) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .await
            .map_err(|_| PLAYBACK_SERVER_ERROR.to_owned())?;
        let port = listener
            .local_addr()
            .map_err(|_| PLAYBACK_SERVER_ERROR.to_owned())?
            .port();
        let token = playback_token()?;
        let router = playback_router(PlaybackHttpState {
            pool,
            token: token.clone(),
        });
        tokio::spawn(async move {
            if axum::serve(listener, router).await.is_err() {
                diagnostics.record_error("playback_server", "server_stopped", "");
            }
        });
        Ok(Self {
            access_probe_slots: Arc::new(Semaphore::new(MAX_PLAYBACK_ACCESS_PROBES)),
            access_probe_timeout: PLAYBACK_ACCESS_TIMEOUT,
            base_url: format!("http://127.0.0.1:{port}"),
            token,
        })
    }

    fn source_url(&self, track_id: &str) -> String {
        format!("{}/media/{}/{}", self.base_url, self.token, track_id)
    }

    #[cfg(test)]
    pub(crate) fn for_test(access_probe_timeout: Duration) -> Self {
        Self {
            access_probe_slots: Arc::new(Semaphore::new(MAX_PLAYBACK_ACCESS_PROBES)),
            access_probe_timeout,
            base_url: "http://127.0.0.1:49152".to_owned(),
            token: "private-token".to_owned(),
        }
    }

    #[cfg(test)]
    pub(crate) async fn verify_test_access(&self, path: PathBuf) -> Result<(), String> {
        self.verify_track_access(path).await
    }

    async fn verify_track_access(&self, path: PathBuf) -> Result<(), String> {
        self.verify_track_access_with(path, |path| std::fs::File::open(path).map(drop))
            .await
    }

    async fn verify_track_access_with<F>(&self, path: PathBuf, open: F) -> Result<(), String>
    where
        F: FnOnce(PathBuf) -> std::io::Result<()> + Send + 'static,
    {
        let permit = tokio::time::timeout(
            PLAYBACK_ACCESS_QUEUE_TIMEOUT,
            self.access_probe_slots.clone().acquire_owned(),
        )
        .await
        .map_err(|_| PLAYBACK_ACCESS_ERROR.to_owned())?
        .map_err(|_| PLAYBACK_ACCESS_ERROR.to_owned())?;
        let (result_sender, result_receiver) = tokio::sync::oneshot::channel();
        let spawn_result = std::thread::Builder::new()
            .name("jukebox-playback-access".to_owned())
            .spawn(move || {
                let _permit = permit;
                let _ = result_sender.send(open(path));
            });
        if spawn_result.is_err() {
            return Err(PLAYBACK_ASSET_ERROR.to_owned());
        }
        match tokio::time::timeout(self.access_probe_timeout, result_receiver).await {
            Ok(Ok(Ok(()))) => Ok(()),
            Ok(_) => Err(PLAYBACK_ASSET_ERROR.to_owned()),
            Err(_) => Err(PLAYBACK_ACCESS_ERROR.to_owned()),
        }
    }
}

fn playback_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| PLAYBACK_SERVER_ERROR.to_owned())?;
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut token, "{byte:02x}").map_err(|_| PLAYBACK_SERVER_ERROR.to_owned())?;
    }
    Ok(token)
}

fn playback_router(state: PlaybackHttpState) -> Router {
    Router::new()
        .route("/media/{token}/{track_id}", get(stream_playback_asset))
        .with_state(state)
}

async fn stream_playback_asset(
    State(state): State<PlaybackHttpState>,
    AxumPath((token, track_id)): AxumPath<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if token != state.token {
        return Err(ApiError::not_found());
    }
    let path = resolve_playback_asset(&state.pool, &track_id)
        .await
        .map_err(|_| ApiError::not_found())?;
    stream_file(&path, headers.get(RANGE)).await
}

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
    library: tauri::State<'_, LibraryState>,
    server: tauri::State<'_, PlaybackAssetServer>,
    diagnostics: tauri::State<'_, DiagnosticsState>,
    track_id: String,
) -> Result<String, String> {
    let path = resolve_playback_asset(&library.pool(), &track_id)
        .await
        .inspect_err(|_| {
            diagnostics.record_error("playback_asset", "resolution_failed", "");
        })?;
    server
        .verify_track_access(path)
        .await
        .inspect_err(|error| {
            let code = if error == PLAYBACK_ACCESS_ERROR {
                "access_timed_out"
            } else {
                "access_failed"
            };
            diagnostics.record_error("playback_asset", code, "");
        })?;
    Ok(server.source_url(&track_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc as std_mpsc, Condvar, Mutex};
    use tower::ServiceExt;

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

    #[test]
    fn timed_out_probe_does_not_poison_later_access_or_spawn_unbounded_workers() {
        tauri::async_runtime::block_on(async {
            let server = PlaybackAssetServer {
                access_probe_slots: Arc::new(Semaphore::new(MAX_PLAYBACK_ACCESS_PROBES)),
                access_probe_timeout: Duration::from_millis(25),
                base_url: "http://127.0.0.1:49152".to_owned(),
                token: "private-token".to_owned(),
            };
            let release = Arc::new((Mutex::new(false), Condvar::new()));
            let calls = Arc::new(AtomicUsize::new(0));
            let (started_tx, started_rx) = std_mpsc::sync_channel(2);
            let blocked_open = |release: Arc<(Mutex<bool>, Condvar)>,
                                calls: Arc<AtomicUsize>,
                                started: std_mpsc::SyncSender<()>| {
                move |_path: PathBuf| {
                    calls.fetch_add(1, Ordering::AcqRel);
                    let _ = started.send(());
                    let (lock, wake) = &*release;
                    let mut released = lock.lock().expect("lock blocked access probe");
                    while !*released {
                        released = wake.wait(released).expect("wait for access release");
                    }
                    Ok(())
                }
            };

            assert_eq!(
                server
                    .verify_track_access_with(
                        PathBuf::from("first"),
                        blocked_open(release.clone(), calls.clone(), started_tx.clone()),
                    )
                    .await
                    .expect_err("first access probe times out"),
                PLAYBACK_ACCESS_ERROR
            );
            started_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("first access probe started");

            server
                .verify_track_access_with(PathBuf::from("healthy"), |_path| Ok(()))
                .await
                .expect("later access uses the independent bounded slot");

            assert_eq!(
                server
                    .verify_track_access_with(
                        PathBuf::from("second"),
                        blocked_open(release.clone(), calls.clone(), started_tx),
                    )
                    .await
                    .expect_err("second access probe times out"),
                PLAYBACK_ACCESS_ERROR
            );
            started_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("second access probe started");
            assert_eq!(
                server
                    .verify_track_access_with(PathBuf::from("bounded"), |_path| {
                        panic!("a third blocked worker must not start")
                    })
                    .await
                    .expect_err("bounded access pool rejects backlog"),
                PLAYBACK_ACCESS_ERROR
            );
            assert_eq!(calls.load(Ordering::Acquire), MAX_PLAYBACK_ACCESS_PROBES);

            let (lock, wake) = &*release;
            *lock.lock().expect("release blocked probes") = true;
            wake.notify_all();
            tokio::time::sleep(Duration::from_millis(25)).await;
            assert_eq!(
                server.access_probe_slots.available_permits(),
                MAX_PLAYBACK_ACCESS_PROBES
            );
        });
    }

    #[test]
    fn streams_only_authorized_tracks_with_byte_ranges() {
        tauri::async_runtime::block_on(async {
            let pool = repository().await;
            let directory = tempfile::tempdir().expect("create playback stream fixture");
            let track = directory.path().join("stream.mp3");
            std::fs::write(&track, b"0123456789").expect("write playback stream fixture");
            insert_track(&pool, "stream", &track, None).await;
            let server = PlaybackAssetServer {
                access_probe_slots: Arc::new(Semaphore::new(MAX_PLAYBACK_ACCESS_PROBES)),
                access_probe_timeout: PLAYBACK_ACCESS_TIMEOUT,
                base_url: "http://127.0.0.1:49152".to_owned(),
                token: "private-token".to_owned(),
            };
            server
                .verify_track_access(track.clone())
                .await
                .expect("probe readable track");
            let app = playback_router(PlaybackHttpState {
                pool,
                token: "private-token".to_owned(),
            });

            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/media/private-token/stream")
                        .header(RANGE, "bytes=2-5")
                        .body(Body::empty())
                        .expect("build ranged playback request"),
                )
                .await
                .expect("stream authorized track");
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(
                to_bytes(response.into_body(), 16)
                    .await
                    .expect("read ranged playback body"),
                b"2345".as_slice()
            );

            let rejected = app
                .oneshot(
                    Request::builder()
                        .uri("/media/wrong-token/stream")
                        .body(Body::empty())
                        .expect("build rejected playback request"),
                )
                .await
                .expect("reject unauthorized stream");
            assert_eq!(rejected.status(), StatusCode::NOT_FOUND);
        });
    }
}

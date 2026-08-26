use crate::settings::{save_settings, AppState};
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path as FilePath, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::{oneshot, Mutex};
use tokio_util::io::ReaderStream;

const INDEX_HTML: &str = include_str!("remote_access/index.html");
const APP_CSS: &str = include_str!("remote_access/app.css");
const APP_JS: &str = include_str!("remote_access/app.js");
const MANIFEST: &str = include_str!("remote_access/manifest.webmanifest");
const SERVICE_WORKER: &str = include_str!("remote_access/sw.js");
const ICON_192: &[u8] = include_bytes!("remote_access/icon-192.png");
const ICON_512: &[u8] = include_bytes!("../icons/icon.png");
const REMOTE_ACCESS_PORT: u16 = 45_321;
const MAX_QUERY_LIMIT: u32 = 100;
const MAX_QUERY_LENGTH: usize = 200;
const MAX_QUERY_OFFSET: u32 = 100_000;

#[derive(Clone, Default)]
pub struct RemoteAccessState {
    inner: Arc<Mutex<RemoteAccessInner>>,
}

#[derive(Default)]
struct RemoteAccessInner {
    handle: Option<RemoteServerHandle>,
    last_error: Option<String>,
}

struct RemoteServerHandle {
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Clone)]
struct HttpState {
    music_root: MusicRootSource,
    pool: SqlitePool,
}

#[derive(Clone)]
enum MusicRootSource {
    App(tauri::AppHandle),
    #[cfg(test)]
    Fixed(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessStatus {
    enabled: bool,
    running: bool,
    port: u16,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Deserialize)]
struct TrackQuery {
    q: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackSummary {
    id: String,
    file: String,
    title: String,
    album: String,
    artist: String,
    duration: String,
    codec: String,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: &'static str,
    content_range: Option<String>,
}

impl ApiError {
    fn internal() -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "The library could not be read",
            content_range: None,
        }
    }

    fn not_found() -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: "Track not found",
            content_range: None,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (
            self.status,
            Json(serde_json::json!({ "error": self.message })),
        )
            .into_response();
        response
            .headers_mut()
            .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
        if let Some(content_range) = self.content_range {
            if let Ok(value) = HeaderValue::from_str(&content_range) {
                response.headers_mut().insert(CONTENT_RANGE, value);
            }
        }
        response
    }
}

impl RemoteAccessState {
    pub async fn start(&self, app: tauri::AppHandle) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        if inner
            .handle
            .as_ref()
            .is_some_and(|handle| !handle.task.is_finished())
        {
            return Ok(());
        }

        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, REMOTE_ACCESS_PORT));
        let listener = tokio::net::TcpListener::bind(address)
            .await
            .map_err(|error| {
                let message = format!("Could not bind {address}: {error}");
                inner.last_error = Some(message.clone());
                message
            })?;
        let state = HttpState::new(app)?;
        let router = router(state);
        let (shutdown, receiver) = oneshot::channel();

        let task = tokio::spawn(async move {
            let server = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = receiver.await;
                })
                .await;
            if let Err(error) = server {
                eprintln!("remote access server stopped: {error}");
            }
        });

        inner.last_error = None;
        inner.handle = Some(RemoteServerHandle {
            shutdown: Some(shutdown),
            task,
        });
        Ok(())
    }

    async fn stop(&self) {
        let handle = self.inner.lock().await.handle.take();
        if let Some(mut handle) = handle {
            if let Some(shutdown) = handle.shutdown.take() {
                let _ = shutdown.send(());
            }
            if tokio::time::timeout(Duration::from_secs(2), &mut handle.task)
                .await
                .is_err()
            {
                handle.task.abort();
                let _ = handle.task.await;
            }
        }
    }

    async fn status(&self, enabled: bool) -> RemoteAccessStatus {
        let inner = self.inner.lock().await;
        let running = inner
            .handle
            .as_ref()
            .is_some_and(|handle| !handle.task.is_finished());
        RemoteAccessStatus {
            enabled,
            running,
            port: REMOTE_ACCESS_PORT,
            url: format!("http://127.0.0.1:{REMOTE_ACCESS_PORT}"),
            error: inner.last_error.clone(),
        }
    }
}

impl HttpState {
    fn new(app: tauri::AppHandle) -> Result<Self, String> {
        let database_path = app
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?
            .join("library.db");
        let options = SqliteConnectOptions::new()
            .filename(database_path)
            .read_only(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_lazy_with(options);
        Ok(Self {
            music_root: MusicRootSource::App(app),
            pool,
        })
    }

    fn music_root(&self) -> Result<String, ApiError> {
        match &self.music_root {
            MusicRootSource::App(app) => app
                .state::<AppState>()
                .settings
                .read()
                .map(|settings| settings.music_folder.clone())
                .map_err(|_| ApiError::internal()),
            #[cfg(test)]
            MusicRootSource::Fixed(root) => Ok(root.clone()),
        }
    }
}

fn router(state: HttpState) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/app.css", get(stylesheet))
        .route("/app.js", get(script))
        .route("/manifest.webmanifest", get(manifest))
        .route("/sw.js", get(service_worker))
        .route("/icons/icon-192.png", get(icon_192))
        .route("/icons/icon-512.png", get(icon_512))
        .route("/api/tracks", get(list_tracks))
        .route("/api/tracks/{id}/stream", get(stream_track))
        .with_state(state)
}

async fn index() -> impl IntoResponse {
    let mut response = Html(INDEX_HTML).into_response();
    response.headers_mut().insert(
        "content-security-policy",
        HeaderValue::from_static(
            "default-src 'none'; style-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        ),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn stylesheet() -> impl IntoResponse {
    static_asset(APP_CSS, "text/css; charset=utf-8")
}

async fn script() -> impl IntoResponse {
    static_asset(APP_JS, "text/javascript; charset=utf-8")
}

async fn manifest() -> impl IntoResponse {
    static_asset(MANIFEST, "application/manifest+json; charset=utf-8")
}

async fn service_worker() -> impl IntoResponse {
    let mut response = static_asset(SERVICE_WORKER, "text/javascript; charset=utf-8");
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response.headers_mut().insert(
        HeaderName::from_static("service-worker-allowed"),
        HeaderValue::from_static("/"),
    );
    response
}

async fn icon_192() -> impl IntoResponse {
    binary_asset(ICON_192, "image/png")
}

async fn icon_512() -> impl IntoResponse {
    binary_asset(ICON_512, "image/png")
}

fn static_asset(content: &'static str, content_type: &'static str) -> Response {
    (
        [
            (CONTENT_TYPE, content_type),
            (CACHE_CONTROL, "private, max-age=3600"),
            (HeaderName::from_static("x-content-type-options"), "nosniff"),
        ],
        content,
    )
        .into_response()
}

fn binary_asset(content: &'static [u8], content_type: &'static str) -> Response {
    Response::builder()
        .header(CONTENT_TYPE, content_type)
        .header(CACHE_CONTROL, "private, max-age=86400")
        .header("x-content-type-options", "nosniff")
        .body(Body::from(content))
        .expect("static response headers are valid")
}

async fn list_tracks(
    State(state): State<HttpState>,
    Query(query): Query<TrackQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let limit = query.limit.unwrap_or(50).clamp(1, MAX_QUERY_LIMIT) as i64;
    let offset = query.offset.unwrap_or(0).min(MAX_QUERY_OFFSET) as i64;
    let query_text = query
        .q
        .as_deref()
        .unwrap_or("")
        .trim()
        .chars()
        .take(MAX_QUERY_LENGTH)
        .collect::<String>();
    let escaped = escape_like(&query_text);
    let pattern = format!("%{escaped}%");
    let rows = sqlx::query(
        "SELECT id, file, title, album, artist, duration, codec FROM songs
         WHERE title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\' OR album LIKE ? ESCAPE '\\'
         ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, side, trackNumber, title COLLATE NOCASE
         LIMIT ? OFFSET ?",
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::internal())?;

    let tracks = rows
        .into_iter()
        .map(|row| TrackSummary {
            id: row.get("id"),
            file: row.get("file"),
            title: row.get("title"),
            album: row.get("album"),
            artist: row.get("artist"),
            duration: row.get("duration"),
            codec: row.get("codec"),
        })
        .collect::<Vec<_>>();

    Ok(([(CACHE_CONTROL, "no-store")], Json(tracks)))
}

async fn stream_track(
    State(state): State<HttpState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let track_path: String = sqlx::query_scalar("SELECT path FROM songs WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::internal())?
        .ok_or_else(ApiError::not_found)?;
    let music_root = state.music_root()?;
    let path = approved_track_path(&music_root, &track_path).await?;
    stream_file(&path, headers.get(RANGE)).await
}

async fn stream_file(
    path: &FilePath,
    range_header: Option<&HeaderValue>,
) -> Result<Response, ApiError> {
    let mut file = File::open(&path).await.map_err(|_| ApiError::not_found())?;
    let total = file
        .metadata()
        .await
        .map_err(|_| ApiError::not_found())?
        .len();
    let range = match range_header {
        Some(value) => Some(parse_range(
            value.to_str().map_err(|_| range_not_satisfiable(total))?,
            total,
        )?),
        None => None,
    };
    let (status, start, end) = range
        .map(|range| (StatusCode::PARTIAL_CONTENT, range.start, range.end))
        .unwrap_or((StatusCode::OK, 0, total.saturating_sub(1)));
    let length = if total == 0 { 0 } else { end - start + 1 };

    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|_| ApiError::internal())?;
    let stream = ReaderStream::new(file.take(length));
    let mut response = Response::builder()
        .status(status)
        .header(ACCEPT_RANGES, "bytes")
        .header(CACHE_CONTROL, "private, no-store")
        .header(CONTENT_LENGTH, length)
        .header(CONTENT_TYPE, content_type(path))
        .body(Body::from_stream(stream))
        .map_err(|_| ApiError::internal())?;

    if status == StatusCode::PARTIAL_CONTENT {
        response.headers_mut().insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{total}"))
                .map_err(|_| ApiError::internal())?,
        );
    }
    Ok(response)
}

async fn approved_track_path(root: &str, track: &str) -> Result<PathBuf, ApiError> {
    if root.is_empty() {
        return Err(ApiError::not_found());
    }
    let root = tokio::fs::canonicalize(root)
        .await
        .map_err(|_| ApiError::not_found())?;
    let track = tokio::fs::canonicalize(track)
        .await
        .map_err(|_| ApiError::not_found())?;
    if track.is_file() && track.starts_with(root) {
        Ok(track)
    } else {
        Err(ApiError::not_found())
    }
}

#[derive(Debug, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end: u64,
}

fn parse_range(value: &str, total: u64) -> Result<ByteRange, ApiError> {
    let range = value
        .strip_prefix("bytes=")
        .filter(|value| !value.contains(','))
        .ok_or_else(|| range_not_satisfiable(total))?;
    let (start, end) = range
        .split_once('-')
        .ok_or_else(|| range_not_satisfiable(total))?;

    if total == 0 {
        return Err(range_not_satisfiable(total));
    }

    let (start, end) = if start.is_empty() {
        let suffix = u64::from_str(end).map_err(|_| range_not_satisfiable(total))?;
        if suffix == 0 {
            return Err(range_not_satisfiable(total));
        }
        (total.saturating_sub(suffix), total - 1)
    } else {
        let start = u64::from_str(start).map_err(|_| range_not_satisfiable(total))?;
        let end = if end.is_empty() {
            total - 1
        } else {
            u64::from_str(end).map_err(|_| range_not_satisfiable(total))?
        };
        (start, end.min(total - 1))
    };

    if start >= total || start > end {
        return Err(range_not_satisfiable(total));
    }
    Ok(ByteRange { start, end })
}

fn range_not_satisfiable(total: u64) -> ApiError {
    ApiError {
        status: StatusCode::RANGE_NOT_SATISFIABLE,
        message: "Requested byte range is not available",
        content_range: Some(format!("bytes */{total}")),
    }
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn content_type(path: &FilePath) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("aac") => "audio/aac",
        Some("flac") => "audio/flac",
        Some("m4a" | "mp4") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("oga" | "ogg" | "opus") => "audio/ogg",
        Some("wav") => "audio/wav",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub async fn get_remote_access_status(
    settings: tauri::State<'_, AppState>,
    remote: tauri::State<'_, RemoteAccessState>,
) -> Result<RemoteAccessStatus, String> {
    let enabled = settings
        .settings
        .read()
        .map_err(|error| error.to_string())?
        .remote_access_enabled;
    Ok(remote.status(enabled).await)
}

#[tauri::command]
pub async fn set_remote_access_enabled(
    app: tauri::AppHandle,
    settings: tauri::State<'_, AppState>,
    remote: tauri::State<'_, RemoteAccessState>,
    enabled: bool,
) -> Result<RemoteAccessStatus, String> {
    if enabled {
        remote.start(app.clone()).await?;
    }

    let updated = {
        let current = settings
            .settings
            .read()
            .map_err(|error| error.to_string())?;
        let mut updated = current.clone();
        updated.remote_access_enabled = enabled;
        updated
    };
    if let Err(error) = save_settings(&app, &updated) {
        if enabled {
            remote.stop().await;
        }
        return Err(error);
    }
    *settings
        .settings
        .write()
        .map_err(|error| error.to_string())? = updated;

    if !enabled {
        remote.stop().await;
    }
    Ok(remote.status(enabled).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::Request;
    use serde_json::Value;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tower::ServiceExt;

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn test_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("jukebox-{label}-{}-{nonce}", std::process::id()))
    }

    async fn insert_song(
        pool: &SqlitePool,
        id: &str,
        path: &FilePath,
        title: &str,
        album: &str,
        artist: &str,
        track_number: i64,
    ) {
        sqlx::query(
            "INSERT INTO songs (
                id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
                trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
                favorRating, dateAdded, visualsPath
             ) VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, '', '', 0, ?, 'mp3', '0:00:10.000',
                       '44100', 0, 0, 0, '2026-08-26', '')",
        )
        .bind(id)
        .bind(path.to_string_lossy().as_ref())
        .bind(
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("track.mp3"),
        )
        .bind(title)
        .bind(album)
        .bind(artist)
        .bind(track_number)
        .execute(pool)
        .await
        .expect("insert fixture song");
    }

    async fn request(router: &Router, uri: &str, range: Option<&str>) -> Response {
        let mut builder = Request::builder().uri(uri);
        if let Some(range) = range {
            builder = builder.header(RANGE, range);
        }
        router
            .clone()
            .oneshot(builder.body(Body::empty()).expect("fixture request"))
            .await
            .expect("router response")
    }

    async fn response_bytes(response: Response) -> Vec<u8> {
        to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body")
            .to_vec()
    }

    #[test]
    fn production_router_enforces_catalog_and_stream_contracts() {
        run_async(async {
            let fixture = test_path("router");
            let root = fixture.join("music");
            let outside = fixture.join("outside.mp3");
            let percent = root.join("percent.mp3");
            let similar = root.join("similar.mp3");
            let alpha = root.join("alpha.mp3");
            std::fs::create_dir_all(&root).expect("create fixture root");
            std::fs::write(&percent, b"0123456789").expect("write percent fixture");
            std::fs::write(&similar, b"similar").expect("write similar fixture");
            std::fs::write(&alpha, b"alpha").expect("write alpha fixture");
            std::fs::write(&outside, b"outside").expect("write outside fixture");

            let database_path = fixture.join("library.db");
            let options = SqliteConnectOptions::new()
                .filename(&database_path)
                .create_if_missing(true);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .expect("open fixture database");
            sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
                .execute(&pool)
                .await
                .expect("migrate fixture database");
            insert_song(&pool, "percent", &percent, "100% Mix", "B", "Zulu", 1).await;
            insert_song(&pool, "similar", &similar, "100X Mix", "A", "Zulu", 2).await;
            insert_song(&pool, "alpha", &alpha, "Alpha", "A", "Alpha", 1).await;
            insert_song(&pool, "outside", &outside, "Outside", "A", "Alpha", 2).await;

            let app = router(HttpState {
                music_root: MusicRootSource::Fixed(root.to_string_lossy().into_owned()),
                pool: pool.clone(),
            });

            let shell = request(&app, "/", None).await;
            assert_eq!(shell.status(), StatusCode::OK);
            assert_eq!(shell.headers()[CACHE_CONTROL], "no-store");
            assert!(shell.headers().contains_key("content-security-policy"));
            assert_eq!(shell.headers()["x-content-type-options"], "nosniff");

            let escaped_search = request(&app, "/api/tracks?q=100%25&limit=100", None).await;
            assert_eq!(escaped_search.status(), StatusCode::OK);
            assert_eq!(escaped_search.headers()[CACHE_CONTROL], "no-store");
            let escaped_json: Value =
                serde_json::from_slice(&response_bytes(escaped_search).await).expect("search JSON");
            let escaped_ids = escaped_json
                .as_array()
                .expect("search array")
                .iter()
                .map(|track| track["id"].as_str().expect("track id"))
                .collect::<Vec<_>>();
            assert_eq!(escaped_ids, vec!["percent"]);

            let ordered_search = request(&app, "/api/tracks?limit=100", None).await;
            let ordered_json: Value = serde_json::from_slice(&response_bytes(ordered_search).await)
                .expect("ordered JSON");
            let ordered_ids = ordered_json
                .as_array()
                .expect("ordered array")
                .iter()
                .map(|track| track["id"].as_str().expect("track id"))
                .collect::<Vec<_>>();
            assert_eq!(ordered_ids, vec!["alpha", "outside", "similar", "percent"]);

            let bounded_search = request(&app, "/api/tracks?limit=0", None).await;
            let bounded_json: Value = serde_json::from_slice(&response_bytes(bounded_search).await)
                .expect("bounded JSON");
            assert_eq!(bounded_json.as_array().map(Vec::len), Some(1));

            let full = request(&app, "/api/tracks/percent/stream", None).await;
            assert_eq!(full.status(), StatusCode::OK);
            assert_eq!(full.headers()[ACCEPT_RANGES], "bytes");
            assert_eq!(full.headers()[CONTENT_LENGTH], "10");
            assert_eq!(full.headers()[CONTENT_TYPE], "audio/mpeg");
            assert_eq!(response_bytes(full).await, b"0123456789");

            let partial = request(&app, "/api/tracks/percent/stream", Some("bytes=2-5")).await;
            assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(partial.headers()[CONTENT_RANGE], "bytes 2-5/10");
            assert_eq!(response_bytes(partial).await, b"2345");

            for invalid_range in ["bytes=8-2", "bytes=0-1,4-5"] {
                let rejected =
                    request(&app, "/api/tracks/percent/stream", Some(invalid_range)).await;
                assert_eq!(rejected.status(), StatusCode::RANGE_NOT_SATISFIABLE);
                assert_eq!(rejected.headers()[CONTENT_RANGE], "bytes */10");
            }

            assert_eq!(
                request(&app, "/api/tracks/missing/stream", None)
                    .await
                    .status(),
                StatusCode::NOT_FOUND
            );
            assert_eq!(
                request(&app, "/api/tracks/outside/stream", None)
                    .await
                    .status(),
                StatusCode::NOT_FOUND
            );

            drop(app);
            pool.close().await;
            std::fs::remove_dir_all(fixture).expect("remove router fixture");
        });
    }

    #[test]
    fn production_router_reports_an_unavailable_database() {
        run_async(async {
            let fixture = test_path("missing-database");
            std::fs::create_dir_all(&fixture).expect("create fixture");
            let options = SqliteConnectOptions::new()
                .filename(fixture.join("missing.db"))
                .read_only(true);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_lazy_with(options);
            let app = router(HttpState {
                music_root: MusicRootSource::Fixed(fixture.to_string_lossy().into_owned()),
                pool,
            });

            let response = request(&app, "/api/tracks", None).await;
            assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
            assert_eq!(response.headers()[CACHE_CONTROL], "no-store");

            drop(app);
            std::fs::remove_dir_all(fixture).expect("remove fixture");
        });
    }

    #[test]
    fn parses_bounded_open_and_suffix_ranges() {
        assert_eq!(
            parse_range("bytes=10-19", 100).expect("bounded range"),
            ByteRange { start: 10, end: 19 }
        );
        assert_eq!(
            parse_range("bytes=90-", 100).expect("open range"),
            ByteRange { start: 90, end: 99 }
        );
        assert_eq!(
            parse_range("bytes=-10", 100).expect("suffix range"),
            ByteRange { start: 90, end: 99 }
        );
        assert_eq!(
            parse_range("bytes=-200", 100).expect("oversized suffix range"),
            ByteRange { start: 0, end: 99 }
        );
    }

    #[test]
    fn rejects_unsafe_or_unsatisfiable_ranges() {
        for value in [
            "items=0-1",
            "bytes=",
            "bytes=10-5",
            "bytes=100-",
            "bytes=0-1,4-5",
        ] {
            assert!(parse_range(value, 100).is_err(), "accepted {value}");
        }
        assert!(parse_range("bytes=0-1", 0).is_err());

        let response = range_not_satisfiable(100).into_response();
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes */100");
    }

    #[test]
    fn escapes_like_wildcards() {
        assert_eq!(escape_like(r"100%_mix\\live"), r"100\%\_mix\\\\live");
    }

    #[test]
    fn maps_common_audio_types() {
        assert_eq!(content_type(FilePath::new("song.MP3")), "audio/mpeg");
        assert_eq!(content_type(FilePath::new("song.flac")), "audio/flac");
        assert_eq!(
            content_type(FilePath::new("song.bin")),
            "application/octet-stream"
        );
    }

    #[test]
    fn pwa_manifest_is_scoped_to_its_private_origin() {
        let manifest: serde_json::Value = serde_json::from_str(MANIFEST).expect("valid manifest");

        assert_eq!(manifest["id"], "/");
        assert_eq!(manifest["start_url"], "/");
        assert_eq!(manifest["scope"], "/");
        assert_eq!(manifest["display"], "standalone");
        assert_eq!(manifest["icons"].as_array().map(Vec::len), Some(2));
        assert_eq!(manifest["icons"][0]["sizes"], "192x192");
        assert_eq!(manifest["icons"][1]["sizes"], "512x512");
        assert_eq!(png_dimensions(ICON_192), (192, 192));
        assert_eq!(png_dimensions(ICON_512), (512, 512));
        assert!(!SERVICE_WORKER.contains("/api/"));
    }

    fn png_dimensions(bytes: &[u8]) -> (u32, u32) {
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
        (
            u32::from_be_bytes(bytes[16..20].try_into().expect("PNG width")),
            u32::from_be_bytes(bytes[20..24].try_into().expect("PNG height")),
        )
    }

    #[test]
    fn only_approves_files_beneath_the_library_root() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "jukebox-remote-access-{}-{nonce}",
            std::process::id()
        ));
        let root = fixture.join("music");
        let inside = root.join("inside.mp3");
        let outside = fixture.join("outside.mp3");
        std::fs::create_dir_all(&root).expect("create fixture root");
        std::fs::write(&inside, b"inside").expect("write inside fixture");
        std::fs::write(&outside, b"outside").expect("write outside fixture");

        run_async(async {
            assert!(approved_track_path(
                root.to_str().expect("root path"),
                inside.to_str().expect("inside path")
            )
            .await
            .is_ok());
            assert!(approved_track_path(
                root.to_str().expect("root path"),
                outside.to_str().expect("outside path")
            )
            .await
            .is_err());
        });

        std::fs::remove_dir_all(fixture).expect("remove fixture");
    }

    #[test]
    fn streams_http_byte_ranges_with_media_headers() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let fixture = std::env::temp_dir().join(format!(
            "jukebox-range-response-{}-{nonce}.mp3",
            std::process::id()
        ));
        std::fs::write(&fixture, b"0123456789").expect("write range fixture");

        let response = run_async(stream_file(
            &fixture,
            Some(&HeaderValue::from_static("bytes=2-5")),
        ))
        .expect("stream byte range");

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[ACCEPT_RANGES], "bytes");
        assert_eq!(response.headers()[CONTENT_RANGE], "bytes 2-5/10");
        assert_eq!(response.headers()[CONTENT_LENGTH], "4");
        assert_eq!(response.headers()[CONTENT_TYPE], "audio/mpeg");

        std::fs::remove_file(fixture).expect("remove range fixture");
    }
}

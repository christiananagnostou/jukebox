use crate::diagnostics::DiagnosticsState;
use crate::library::{
    AggregateQuery as LibraryAggregateQuery, AlbumPage as LibraryAlbumPage,
    ArtistPage as LibraryArtistPage, LibraryError, LibraryState, TrackQuery as LibraryTrackQuery,
    TrackSummary as LibraryTrackSummary, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE,
};
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
const PLAYER_CORE_JS: &str = include_str!("remote_access/player-core.js");
const MANIFEST: &str = include_str!("remote_access/manifest.webmanifest");
const SERVICE_WORKER: &str = include_str!("remote_access/sw.js");
const ICON_192: &[u8] = include_bytes!("remote_access/icon-192.png");
const ICON_512: &[u8] = include_bytes!("../icons/icon.png");
const REMOTE_ACCESS_PORT: u16 = 45_321;
const NEXT_CURSOR_HEADER: &str = "x-jukebox-next-cursor";
const CATALOG_REVISION_HEADER: &str = "x-jukebox-catalog-revision";

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
    library: LibraryState,
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
struct RemoteTrackQuery {
    album: Option<String>,
    artist: Option<String>,
    q: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
struct RemoteAggregateQuery {
    artist: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    q: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteTrackSummary {
    id: String,
    file: String,
    title: String,
    album: String,
    artist: String,
    duration: String,
    codec: String,
}

impl From<LibraryTrackSummary> for RemoteTrackSummary {
    fn from(track: LibraryTrackSummary) -> Self {
        Self {
            id: track.id,
            file: track.file,
            title: track.title,
            album: track.album,
            artist: track.artist,
            duration: track.duration,
            codec: track.codec,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteArtistSummary {
    album_count: i64,
    name: String,
    track_count: i64,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteAlbumSummary {
    artist: String,
    artist_value: String,
    date: String,
    name: String,
    track_count: i64,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemotePage<T> {
    items: Vec<T>,
    revision: i64,
    total: i64,
}

impl From<LibraryArtistPage> for RemotePage<RemoteArtistSummary> {
    fn from(page: LibraryArtistPage) -> Self {
        Self {
            items: page
                .items
                .into_iter()
                .map(|artist| RemoteArtistSummary {
                    album_count: artist.album_count,
                    name: artist.name,
                    track_count: artist.track_count,
                    value: artist.value,
                })
                .collect(),
            revision: page.revision,
            total: page.total,
        }
    }
}

impl From<LibraryAlbumPage> for RemotePage<RemoteAlbumSummary> {
    fn from(page: LibraryAlbumPage) -> Self {
        Self {
            items: page
                .items
                .into_iter()
                .map(|album| RemoteAlbumSummary {
                    artist: album.artist,
                    artist_value: album.artist_value,
                    date: album.date,
                    name: album.name,
                    track_count: album.track_count,
                    value: album.value,
                })
                .collect(),
            revision: page.revision,
            total: page.total,
        }
    }
}

#[derive(Debug)]
pub(crate) struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
    content_range: Option<String>,
}

impl ApiError {
    fn internal() -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "database_unavailable",
            message: "The library could not be read",
            content_range: None,
        }
    }

    pub(crate) fn not_found() -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "track_not_found",
            message: "Track not found",
            content_range: None,
        }
    }

    fn library(error: LibraryError) -> Self {
        let (status, code, message) = match error.code.as_str() {
            "invalid_cursor" => (
                StatusCode::BAD_REQUEST,
                "invalid_cursor",
                "The catalog cursor is invalid",
            ),
            "invalid_query" => (
                StatusCode::BAD_REQUEST,
                "invalid_query",
                "The catalog query is invalid",
            ),
            "stale_cursor" => (
                StatusCode::CONFLICT,
                "stale_cursor",
                "The music library changed; restart from the first page",
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "database_unavailable",
                "The library could not be read",
            ),
        };
        Self {
            status,
            code,
            message,
            content_range: None,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (
            self.status,
            Json(serde_json::json!({ "code": self.code, "error": self.message })),
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

        let diagnostics = app
            .try_state::<DiagnosticsState>()
            .map(|state| state.inner().clone());
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, REMOTE_ACCESS_PORT));
        let listener = match tokio::net::TcpListener::bind(address).await {
            Ok(listener) => listener,
            Err(error) => {
                if let Some(diagnostics) = &diagnostics {
                    diagnostics.record_error("remote_access", "bind_failed", "port=45321");
                }
                let message = format!("Could not bind {address}: {error}");
                inner.last_error = Some(message.clone());
                return Err(message);
            }
        };
        let state = HttpState::new(app)?;
        let router = router(state);
        let (shutdown, receiver) = oneshot::channel();

        let task_diagnostics = diagnostics.clone();
        let task = tokio::spawn(async move {
            let server = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = receiver.await;
                })
                .await;
            if server.is_err() {
                if let Some(diagnostics) = task_diagnostics {
                    diagnostics.record_error("remote_access", "server_stopped", "port=45321");
                }
            }
        });

        inner.last_error = None;
        inner.handle = Some(RemoteServerHandle {
            shutdown: Some(shutdown),
            task,
        });
        if let Some(diagnostics) = diagnostics {
            diagnostics.record_info("remote_access", "started", "port=45321");
        }
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
        let library = app.state::<LibraryState>().inner().clone();
        let pool = library.pool();
        Ok(Self {
            music_root: MusicRootSource::App(app),
            library,
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
        .route("/player-core.js", get(player_core))
        .route("/manifest.webmanifest", get(manifest))
        .route("/sw.js", get(service_worker))
        .route("/icons/icon-192.png", get(icon_192))
        .route("/icons/icon-512.png", get(icon_512))
        .route("/api/tracks", get(list_tracks))
        .route("/api/artists", get(list_artists))
        .route("/api/albums", get(list_albums))
        .route("/api/artwork", get(album_artwork))
        .route("/api/tracks/{id}/artwork", get(track_artwork))
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

async fn player_core() -> impl IntoResponse {
    static_asset(PLAYER_CORE_JS, "text/javascript; charset=utf-8")
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
    Query(query): Query<RemoteTrackQuery>,
) -> Result<Response, ApiError> {
    let page = state
        .library
        .query_tracks(LibraryTrackQuery {
            album: query.album,
            artist: query.artist,
            cursor: query.cursor,
            limit: query
                .limit
                .unwrap_or(DEFAULT_PAGE_SIZE)
                .clamp(1, MAX_PAGE_SIZE),
            q: query.q.unwrap_or_default(),
            ..LibraryTrackQuery::default()
        })
        .await
        .map_err(ApiError::library)?;
    let tracks = page
        .items
        .into_iter()
        .map(RemoteTrackSummary::from)
        .collect::<Vec<_>>();
    let mut response = Json(tracks).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        HeaderName::from_static(CATALOG_REVISION_HEADER),
        HeaderValue::from_str(&page.revision.to_string()).map_err(|_| ApiError::internal())?,
    );
    if let Some(cursor) = page.next_cursor {
        response.headers_mut().insert(
            HeaderName::from_static(NEXT_CURSOR_HEADER),
            HeaderValue::from_str(&cursor).map_err(|_| ApiError::internal())?,
        );
    }
    Ok(response)
}

async fn list_artists(
    State(state): State<HttpState>,
    Query(query): Query<RemoteAggregateQuery>,
) -> Result<Response, ApiError> {
    let page = state
        .library
        .query_artists(LibraryAggregateQuery {
            limit: query
                .limit
                .unwrap_or(DEFAULT_PAGE_SIZE)
                .clamp(1, MAX_PAGE_SIZE),
            offset: query.offset.unwrap_or_default(),
            q: query.q.unwrap_or_default(),
            ..LibraryAggregateQuery::default()
        })
        .await
        .map_err(ApiError::library)?;
    api_json(RemotePage::<RemoteArtistSummary>::from(page))
}

async fn list_albums(
    State(state): State<HttpState>,
    Query(query): Query<RemoteAggregateQuery>,
) -> Result<Response, ApiError> {
    let page = state
        .library
        .query_albums(LibraryAggregateQuery {
            artist: query.artist,
            limit: query
                .limit
                .unwrap_or(DEFAULT_PAGE_SIZE)
                .clamp(1, MAX_PAGE_SIZE),
            offset: query.offset.unwrap_or_default(),
            q: query.q.unwrap_or_default(),
            ..LibraryAggregateQuery::default()
        })
        .await
        .map_err(ApiError::library)?;
    api_json(RemotePage::<RemoteAlbumSummary>::from(page))
}

fn api_json<T: Serialize>(value: T) -> Result<Response, ApiError> {
    let mut response = Json(value).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

#[derive(Deserialize)]
struct ArtworkQuery {
    album: String,
    artist: Option<String>,
}

async fn album_artwork(
    State(state): State<HttpState>,
    Query(query): Query<ArtworkQuery>,
) -> Result<Response, ApiError> {
    let path = sqlx::query_scalar::<_, String>(
        "SELECT visualsPath FROM songs WHERE album = ?
         AND (? IS NULL OR artist = ?) AND visualsPath <> ''
         AND availability = 'available'
         AND (root_id IS NULL OR root_id IN (SELECT id FROM library_roots WHERE enabled = 1))
         ORDER BY visualsPath LIMIT 1",
    )
    .bind(query.album)
    .bind(&query.artist)
    .bind(&query.artist)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal())?
    .ok_or_else(ApiError::not_found)?;
    serve_artwork(&state, &path).await
}

async fn track_artwork(
    State(state): State<HttpState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let path = sqlx::query_scalar::<_, String>(
        "SELECT visualsPath FROM songs WHERE id = ? AND availability = 'available'
         AND (root_id IS NULL OR root_id IN (SELECT id FROM library_roots WHERE enabled = 1))",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal())?
    .ok_or_else(ApiError::not_found)?;
    serve_artwork(&state, &path).await
}

async fn serve_artwork(state: &HttpState, path: &str) -> Result<Response, ApiError> {
    let root = match &state.music_root {
        MusicRootSource::App(app) => app
            .path()
            .app_local_data_dir()
            .map_err(|_| ApiError::internal())?
            .join("Jukebox")
            .join("art"),
        #[cfg(test)]
        MusicRootSource::Fixed(root) => PathBuf::from(root).join("art"),
    };
    let approved = approved_track_path(&root.to_string_lossy(), path).await?;
    let file = File::open(approved)
        .await
        .map_err(|_| ApiError::not_found())?;
    let mut bytes = Vec::new();
    file.take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| ApiError::not_found())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err(ApiError::not_found());
    }
    let media_type = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        return Err(ApiError::not_found());
    };
    Ok((
        [
            (CONTENT_TYPE, media_type),
            (CACHE_CONTROL, "private, max-age=300"),
            (HeaderName::from_static("x-content-type-options"), "nosniff"),
        ],
        bytes,
    )
        .into_response())
}

async fn stream_track(
    State(state): State<HttpState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let row = sqlx::query(
        "SELECT songs.path, songs.root_id, roots.canonical_path, roots.enabled
         FROM songs
         LEFT JOIN library_roots AS roots ON roots.id = songs.root_id
         WHERE songs.id = ? AND songs.availability = 'available'",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::internal())?
    .ok_or_else(ApiError::not_found)?;
    let track_path: String = row.try_get("path").map_err(|_| ApiError::internal())?;
    let root_id: Option<i64> = row.try_get("root_id").map_err(|_| ApiError::internal())?;
    let approved_root = if root_id.is_some() {
        let enabled: Option<i64> = row.try_get("enabled").map_err(|_| ApiError::internal())?;
        if enabled != Some(1) {
            return Err(ApiError::not_found());
        }
        row.try_get::<Option<String>, _>("canonical_path")
            .map_err(|_| ApiError::internal())?
            .ok_or_else(ApiError::not_found)?
    } else {
        state.music_root()?
    };
    let path = approved_track_path(&approved_root, &track_path).await?;
    stream_file(&path, headers.get(RANGE)).await
}

pub(crate) async fn stream_file(
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
        code: "range_not_satisfiable",
        message: "Requested byte range is not available",
        content_range: Some(format!("bytes */{total}")),
    }
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
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
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
            let native_root = fixture.join("native-music");
            let outside = fixture.join("outside.mp3");
            let percent = root.join("percent.mp3");
            let similar = root.join("similar.mp3");
            let alpha = root.join("alpha.mp3");
            std::fs::create_dir_all(&root).expect("create fixture root");
            std::fs::create_dir_all(&native_root).expect("create native root");
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
            sqlx::raw_sql(include_str!("../migrations/0002_catalog_query.sql"))
                .execute(&pool)
                .await
                .expect("migrate catalog query schema");
            insert_song(&pool, "percent", &percent, "100% Mix", "B", "Zulu", 1).await;
            insert_song(&pool, "similar", &similar, "100X Mix", "A", "Zulu", 2).await;
            insert_song(&pool, "alpha", &alpha, "Alpha", "A", "Alpha", 1).await;
            insert_song(&pool, "outside", &outside, "Outside", "A", "Alpha", 2).await;

            let app = router(HttpState {
                music_root: MusicRootSource::Fixed(root.to_string_lossy().into_owned()),
                library: LibraryState::from_pool(pool.clone()),
                pool: pool.clone(),
            });

            let shell = request(&app, "/", None).await;
            assert_eq!(
                request(&app, "/api/tracks", None).await.status(),
                StatusCode::OK
            );
            let art = root.join("art").join("cover.png");
            std::fs::create_dir_all(art.parent().expect("art directory")).expect("create art");
            std::fs::write(&art, ICON_192).expect("write art");
            sqlx::query("UPDATE songs SET visualsPath = ? WHERE id = 'percent'")
                .bind(art.to_string_lossy().as_ref())
                .execute(&pool)
                .await
                .expect("set art");
            let cover = request(&app, "/api/tracks/percent/artwork", None).await;
            assert_eq!(cover.status(), StatusCode::OK);
            assert_eq!(cover.headers()[CONTENT_TYPE], "image/png");
            assert_eq!(response_bytes(cover).await, ICON_192);
            assert_eq!(
                request(&app, "/api/artwork?album=B&artist=Zulu", None)
                    .await
                    .status(),
                StatusCode::OK
            );
            assert_eq!(
                request(&app, "/api/tracks/missing/artwork", None)
                    .await
                    .status(),
                StatusCode::NOT_FOUND
            );
            sqlx::query("UPDATE songs SET visualsPath = ? WHERE id = 'percent'")
                .bind(outside.to_string_lossy().as_ref())
                .execute(&pool)
                .await
                .expect("set outside art");
            assert_eq!(
                request(&app, "/api/tracks/percent/artwork", None)
                    .await
                    .status(),
                StatusCode::NOT_FOUND
            );
            assert_eq!(
                request(&app, "/api/artwork?album=B", None).await.status(),
                StatusCode::NOT_FOUND
            );
            std::fs::write(&art, b"<html>not an image</html>").expect("write invalid art");
            sqlx::query("UPDATE songs SET visualsPath = ? WHERE id = 'percent'")
                .bind(art.to_string_lossy().as_ref())
                .execute(&pool)
                .await
                .expect("set invalid art");
            assert_eq!(
                request(&app, "/api/tracks/percent/artwork", None)
                    .await
                    .status(),
                StatusCode::NOT_FOUND
            );
            assert_eq!(shell.status(), StatusCode::OK);
            assert_eq!(shell.headers()[CACHE_CONTROL], "no-store");
            assert!(shell.headers().contains_key("content-security-policy"));
            let content_security_policy = shell.headers()["content-security-policy"]
                .to_str()
                .expect("content security policy");
            assert!(content_security_policy.contains("script-src 'self'"));
            assert!(!content_security_policy.contains("'unsafe-inline'"));
            assert!(!content_security_policy.contains("'unsafe-eval'"));
            assert_eq!(shell.headers()["x-content-type-options"], "nosniff");

            let player_core = request(&app, "/player-core.js", None).await;
            assert_eq!(player_core.status(), StatusCode::OK);
            assert_eq!(
                player_core.headers()[CONTENT_TYPE],
                "text/javascript; charset=utf-8"
            );
            assert_eq!(
                player_core.headers()[CACHE_CONTROL],
                "private, max-age=3600"
            );
            assert_eq!(response_bytes(player_core).await, PLAYER_CORE_JS.as_bytes());

            let escaped_search = request(&app, "/api/tracks?q=100%25&limit=100", None).await;
            assert_eq!(escaped_search.status(), StatusCode::OK);
            assert_eq!(escaped_search.headers()[CACHE_CONTROL], "no-store");
            let escaped_json: Value =
                serde_json::from_slice(&response_bytes(escaped_search).await).expect("search JSON");
            assert!(escaped_json[0].get("path").is_none());
            let escaped_ids = escaped_json
                .as_array()
                .expect("search array")
                .iter()
                .map(|track| track["id"].as_str().expect("track id"))
                .collect::<Vec<_>>();
            assert_eq!(escaped_ids, vec!["percent"]);

            let ordered_search = request(&app, "/api/tracks?limit=100", None).await;
            assert_eq!(ordered_search.headers()[CATALOG_REVISION_HEADER], "7");
            assert!(!ordered_search.headers().contains_key(NEXT_CURSOR_HEADER));
            let ordered_json: Value = serde_json::from_slice(&response_bytes(ordered_search).await)
                .expect("ordered JSON");
            let ordered_ids = ordered_json
                .as_array()
                .expect("ordered array")
                .iter()
                .map(|track| track["id"].as_str().expect("track id"))
                .collect::<Vec<_>>();
            assert_eq!(ordered_ids, vec!["alpha", "outside", "similar", "percent"]);

            let artists = request(&app, "/api/artists?limit=1", None).await;
            assert_eq!(artists.status(), StatusCode::OK);
            assert_eq!(artists.headers()[CACHE_CONTROL], "no-store");
            let artists_json: Value =
                serde_json::from_slice(&response_bytes(artists).await).expect("artists JSON");
            assert_eq!(artists_json["total"], 2);
            assert_eq!(artists_json["items"][0]["value"], "Alpha");

            let albums = request(&app, "/api/albums?artist=Zulu&limit=100", None).await;
            assert_eq!(albums.status(), StatusCode::OK);
            let albums_json: Value =
                serde_json::from_slice(&response_bytes(albums).await).expect("albums JSON");
            assert_eq!(albums_json["total"], 2);
            assert!(albums_json["items"][0].get("visualsPath").is_none());
            assert!(albums_json["items"][0].get("path").is_none());

            let album_tracks = request(&app, "/api/tracks?artist=Zulu&album=B", None).await;
            let album_json: Value = serde_json::from_slice(&response_bytes(album_tracks).await)
                .expect("album tracks JSON");
            assert_eq!(album_json.as_array().map(Vec::len), Some(1));
            assert_eq!(album_json[0]["id"], "percent");

            let bounded_search = request(&app, "/api/tracks?limit=0", None).await;
            let bounded_json: Value = serde_json::from_slice(&response_bytes(bounded_search).await)
                .expect("bounded JSON");
            assert_eq!(bounded_json.as_array().map(Vec::len), Some(1));

            let first_page = request(&app, "/api/tracks?limit=2", None).await;
            assert_eq!(first_page.status(), StatusCode::OK);
            let first_revision = first_page.headers()[CATALOG_REVISION_HEADER].clone();
            let cursor = first_page.headers()[NEXT_CURSOR_HEADER]
                .to_str()
                .expect("cursor header")
                .to_owned();
            let first_json: Value =
                serde_json::from_slice(&response_bytes(first_page).await).expect("first page JSON");
            let first_ids = first_json
                .as_array()
                .expect("first page array")
                .iter()
                .map(|track| track["id"].as_str().expect("track id"))
                .collect::<Vec<_>>();

            let second_page =
                request(&app, &format!("/api/tracks?limit=2&cursor={cursor}"), None).await;
            assert_eq!(second_page.status(), StatusCode::OK);
            assert_eq!(
                second_page.headers()[CATALOG_REVISION_HEADER],
                first_revision
            );
            assert!(!second_page.headers().contains_key(NEXT_CURSOR_HEADER));
            let second_json: Value = serde_json::from_slice(&response_bytes(second_page).await)
                .expect("second page JSON");
            let second_ids = second_json
                .as_array()
                .expect("second page array")
                .iter()
                .map(|track| track["id"].as_str().expect("track id"))
                .collect::<Vec<_>>();
            assert_eq!(first_ids, vec!["alpha", "outside"]);
            assert_eq!(second_ids, vec!["similar", "percent"]);

            sqlx::query("UPDATE songs SET title = 'Updated' WHERE id = 'percent'")
                .execute(&pool)
                .await
                .expect("mutate catalog");
            let stale = request(&app, &format!("/api/tracks?limit=2&cursor={cursor}"), None).await;
            assert_eq!(stale.status(), StatusCode::CONFLICT);
            let stale_json: Value =
                serde_json::from_slice(&response_bytes(stale).await).expect("stale cursor JSON");
            assert_eq!(stale_json["code"], "stale_cursor");

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

            let native_track = native_root.join("native.mp3");
            std::fs::write(&native_track, b"native").expect("write native-root fixture");
            let native_root_id: i64 = sqlx::query_scalar(
                "INSERT INTO library_roots (path, canonical_path, enabled)
                 VALUES (?, ?, 1) RETURNING id",
            )
            .bind(native_root.to_string_lossy().as_ref())
            .bind(native_root.to_string_lossy().as_ref())
            .fetch_one(&pool)
            .await
            .expect("insert native root");
            insert_song(
                &pool,
                "native",
                &native_track,
                "Native",
                "Rooted",
                "Artist",
                1,
            )
            .await;
            sqlx::query("UPDATE songs SET root_id = ? WHERE id = 'native'")
                .bind(native_root_id)
                .execute(&pool)
                .await
                .expect("assign native root");
            let native_stream = request(&app, "/api/tracks/native/stream", None).await;
            assert_eq!(native_stream.status(), StatusCode::OK);
            assert_eq!(response_bytes(native_stream).await, b"native");

            sqlx::query("UPDATE library_roots SET enabled = 0 WHERE id = ?")
                .bind(native_root_id)
                .execute(&pool)
                .await
                .expect("disable native root");
            assert_eq!(
                request(&app, "/api/tracks/native/stream", None)
                    .await
                    .status(),
                StatusCode::NOT_FOUND
            );

            drop(app);
            pool.close().await;
            drop(pool);
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
                library: LibraryState::from_pool(pool.clone()),
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
        assert!(SERVICE_WORKER.contains("jukebox-shell-v6"));
        assert!(SERVICE_WORKER.contains("'/player-core.js'"));
        assert!(SERVICE_WORKER.contains("new Request(path, { cache: 'reload' })"));
        assert!(SERVICE_WORKER.contains("new Request(event.request, { cache: 'reload' })"));
        assert!(SERVICE_WORKER.contains("self.skipWaiting()"));
        for view in ["tracks", "albums", "artists"] {
            assert!(INDEX_HTML.contains(&format!("data-view=\"{view}\"")));
            assert!(APP_JS.contains(&format!("view = '{view}'")));
        }
        assert!(INDEX_HTML.contains("<script type=\"module\" src=\"/app.js\"></script>"));
        assert!(INDEX_HTML.contains("id=\"queue-panel\""));
        assert!(INDEX_HTML.contains("id=\"playback-actions\""));
        assert!(APP_JS.contains("from './player-core.js'"));
        assert!(APP_JS.contains("/api/${view}"));
        assert!(APP_JS.contains("x-jukebox-next-cursor"));
        assert!(APP_JS.contains("window.localStorage"));
        assert!(APP_JS.contains("visibilitychange"));
        assert!(APP_JS.contains("POSITION_CHECKPOINT_MILLISECONDS = 5_000"));
        assert!(APP_JS.contains("PROBE_TIMEOUT_MILLISECONDS = 5_000"));
        assert!(APP_JS.contains("const controller = new AbortController()"));
        assert!(APP_JS.contains("restoreDeviceSession()"));
        assert!(!APP_JS.contains("visualsPath"));
        assert!(!PLAYER_CORE_JS.contains("document."));
        assert!(!PLAYER_CORE_JS.contains("localStorage"));
        assert!(!PLAYER_CORE_JS.contains("/api/"));
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

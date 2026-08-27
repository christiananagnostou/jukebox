mod aggregates;
mod collections;
mod facets;
mod m3u;
#[cfg(test)]
mod performance;
mod playlists;
mod query;
mod reconciliation;
mod refresh;
mod repository;
mod roots;
mod scanner;
mod smart_playlists;
pub(crate) mod storage;
mod watcher;

pub use aggregates::{query_albums, query_artists, AggregateQuery, AlbumPage, ArtistPage};
pub use collections::{BuiltInCollectionPage, BuiltInCollectionQuery};
pub use facets::{FacetPage, FacetQuery};
pub use m3u::{
    M3uExportResult, M3uImportPreview, M3uImportResult, M3uIssuePage, M3uIssueQuery, M3uState,
};
pub use playlists::{
    PlaylistEntryPage, PlaylistEntryQuery, PlaylistMoveDirection, PlaylistMutation, PlaylistPage,
    PlaylistQuery, PlaylistSummary,
};
pub use query::{LibraryError, TrackQuery, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE};
pub use reconciliation::LibraryReconciliation;
pub use refresh::{
    cancel_library_refresh, get_library_refresh, list_library_refreshes, start_library_refresh,
};
pub use repository::{LibraryRepository, TrackPage, TrackSummary};
pub use roots::LibraryRoot;
pub use scanner::LibraryScan;
pub use smart_playlists::{
    SmartPlaylist, SmartPlaylistDefinition, SmartPlaylistPage, SmartPlaylistQuery,
};
pub use storage::{StoragePage, StorageQuery};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tokio::sync::OnceCell;

use crate::artwork::ArtworkCache;

const MAX_PLAYBACK_TRACKS: usize = 10_000;
const MAX_PLAYBACK_TRACK_ID_LENGTH: usize = 128;

#[derive(Clone)]
pub struct LibraryState {
    initialized: Arc<OnceCell<Result<(), LibraryError>>>,
    active_refreshes: refresh::ActiveRefreshes,
    artwork_cache: Option<ArtworkCache>,
    repository: LibraryRepository,
    reconciliation: reconciliation::ReconciliationService,
    scanner: scanner::ScannerService,
    watchers: watcher::WatcherService,
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
        Ok(Self::from_pool_and_artwork_cache(
            pool,
            Some(ArtworkCache::from_app(app)?),
        ))
    }

    #[cfg(test)]
    pub(crate) fn from_pool(pool: SqlitePool) -> Self {
        Self::from_pool_and_artwork_cache(pool, None)
    }

    fn from_pool_and_artwork_cache(pool: SqlitePool, artwork_cache: Option<ArtworkCache>) -> Self {
        Self {
            initialized: Arc::new(OnceCell::new()),
            active_refreshes: refresh::ActiveRefreshes::default(),
            artwork_cache,
            repository: LibraryRepository::new(pool.clone()),
            reconciliation: reconciliation::ReconciliationService::new(pool.clone()),
            scanner: scanner::ScannerService::new(pool),
            watchers: watcher::WatcherService::default(),
        }
    }

    #[cfg(test)]
    pub(crate) fn from_pool_with_artwork_root(pool: SqlitePool, root: std::path::PathBuf) -> Self {
        Self::from_pool_and_artwork_cache(pool, Some(ArtworkCache::from_root(root)))
    }

    pub(crate) fn pool(&self) -> SqlitePool {
        self.repository.pool()
    }

    pub async fn query_tracks(&self, query: TrackQuery) -> Result<TrackPage, LibraryError> {
        self.ensure_initialized().await?;
        self.repository.query_tracks(query).await
    }

    pub async fn query_facets(&self, query: FacetQuery) -> Result<FacetPage, LibraryError> {
        self.ensure_initialized().await?;
        facets::load_facet_page(&self.repository.pool(), query).await
    }

    pub async fn query_built_in_collection(
        &self,
        query: BuiltInCollectionQuery,
    ) -> Result<BuiltInCollectionPage, LibraryError> {
        self.ensure_initialized().await?;
        collections::load_built_in_collection(&self.repository.pool(), query).await
    }

    pub async fn create_playlist(&self, name: String) -> Result<PlaylistSummary, LibraryError> {
        self.ensure_initialized().await?;
        playlists::create_playlist(&self.repository.pool(), name).await
    }

    pub async fn list_playlists(&self, query: PlaylistQuery) -> Result<PlaylistPage, LibraryError> {
        self.ensure_initialized().await?;
        playlists::list_playlists(&self.repository.pool(), query).await
    }

    pub async fn rename_playlist(
        &self,
        playlist_id: String,
        name: String,
    ) -> Result<PlaylistSummary, LibraryError> {
        self.ensure_initialized().await?;
        playlists::rename_playlist(&self.repository.pool(), playlist_id, name).await
    }

    pub async fn delete_playlist(
        &self,
        playlist_id: String,
    ) -> Result<PlaylistMutation, LibraryError> {
        self.ensure_initialized().await?;
        playlists::delete_playlist(&self.repository.pool(), playlist_id).await
    }

    pub async fn duplicate_playlist(
        &self,
        playlist_id: String,
        name: String,
    ) -> Result<PlaylistSummary, LibraryError> {
        self.ensure_initialized().await?;
        playlists::duplicate_playlist(&self.repository.pool(), playlist_id, name).await
    }

    pub async fn add_playlist_entries(
        &self,
        playlist_id: String,
        song_ids: Vec<String>,
    ) -> Result<PlaylistMutation, LibraryError> {
        self.ensure_initialized().await?;
        playlists::add_playlist_entries(&self.repository.pool(), playlist_id, song_ids).await
    }

    pub async fn list_playlist_entries(
        &self,
        playlist_id: String,
        query: PlaylistEntryQuery,
    ) -> Result<PlaylistEntryPage, LibraryError> {
        self.ensure_initialized().await?;
        playlists::list_playlist_entries(&self.repository.pool(), playlist_id, query).await
    }

    pub async fn remove_playlist_entries(
        &self,
        playlist_id: String,
        entry_ids: Vec<String>,
    ) -> Result<PlaylistMutation, LibraryError> {
        self.ensure_initialized().await?;
        playlists::remove_playlist_entries(&self.repository.pool(), playlist_id, entry_ids).await
    }

    pub async fn move_playlist_entry(
        &self,
        playlist_id: String,
        entry_id: String,
        direction: PlaylistMoveDirection,
    ) -> Result<PlaylistMutation, LibraryError> {
        self.ensure_initialized().await?;
        playlists::move_playlist_entry(&self.repository.pool(), playlist_id, entry_id, direction)
            .await
    }

    pub async fn create_smart_playlist(
        &self,
        name: String,
        definition: SmartPlaylistDefinition,
    ) -> Result<SmartPlaylist, LibraryError> {
        self.ensure_initialized().await?;
        smart_playlists::create_smart_playlist(&self.repository.pool(), name, definition).await
    }

    pub async fn get_smart_playlist(
        &self,
        playlist_id: String,
    ) -> Result<SmartPlaylist, LibraryError> {
        self.ensure_initialized().await?;
        smart_playlists::get_smart_playlist(&self.repository.pool(), playlist_id).await
    }

    pub async fn update_smart_playlist(
        &self,
        playlist_id: String,
        name: String,
        definition: SmartPlaylistDefinition,
    ) -> Result<SmartPlaylist, LibraryError> {
        self.ensure_initialized().await?;
        smart_playlists::update_smart_playlist(
            &self.repository.pool(),
            playlist_id,
            name,
            definition,
        )
        .await
    }

    pub async fn delete_smart_playlist(
        &self,
        playlist_id: String,
    ) -> Result<PlaylistMutation, LibraryError> {
        self.ensure_initialized().await?;
        smart_playlists::delete_smart_playlist(&self.repository.pool(), playlist_id).await
    }

    pub async fn query_smart_playlist(
        &self,
        playlist_id: String,
        query: SmartPlaylistQuery,
    ) -> Result<SmartPlaylistPage, LibraryError> {
        self.ensure_initialized().await?;
        smart_playlists::query_smart_playlist(&self.repository.pool(), playlist_id, query).await
    }

    pub async fn pick_m3u_import(
        &self,
        app: tauri::AppHandle,
        state: M3uState,
    ) -> Result<Option<M3uImportPreview>, LibraryError> {
        self.ensure_initialized().await?;
        m3u::pick_m3u_import(app, self.repository.pool(), state).await
    }

    pub async fn apply_m3u_import(
        &self,
        state: &M3uState,
        token: String,
        name: String,
    ) -> Result<M3uImportResult, LibraryError> {
        self.ensure_initialized().await?;
        m3u::apply_m3u_import(&self.repository.pool(), state, token, name).await
    }

    pub async fn pick_m3u_export(
        &self,
        app: tauri::AppHandle,
        playlist_id: String,
    ) -> Result<Option<M3uExportResult>, LibraryError> {
        self.ensure_initialized().await?;
        m3u::pick_m3u_export(app, self.repository.pool(), playlist_id).await
    }

    pub async fn resolve_playback_tracks(
        &self,
        track_ids: Vec<String>,
    ) -> Result<Vec<TrackSummary>, LibraryError> {
        if track_ids.len() > MAX_PLAYBACK_TRACKS
            || track_ids.iter().any(|track_id| {
                track_id.is_empty()
                    || track_id.len() > MAX_PLAYBACK_TRACK_ID_LENGTH
                    || !track_id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            })
        {
            return Err(LibraryError::invalid_query(
                "Playback track identifiers must be opaque, present, and bounded.",
            ));
        }
        self.ensure_initialized().await?;
        self.repository.tracks_by_ids(&track_ids).await
    }

    pub async fn query_artists(&self, query: AggregateQuery) -> Result<ArtistPage, LibraryError> {
        self.ensure_initialized().await?;
        aggregates::load_artist_page(&self.repository.pool(), query).await
    }

    pub async fn query_albums(&self, query: AggregateQuery) -> Result<AlbumPage, LibraryError> {
        self.ensure_initialized().await?;
        aggregates::load_album_page(&self.repository.pool(), query).await
    }

    pub async fn query_storage(&self, query: StorageQuery) -> Result<StoragePage, LibraryError> {
        self.ensure_initialized().await?;
        storage::load_storage_page(&self.repository.pool(), query).await
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

    pub(crate) async fn get_library_root(&self, id: i64) -> Result<LibraryRoot, LibraryError> {
        self.ensure_initialized().await?;
        roots::get_library_root(&self.repository.pool(), id).await
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

    pub async fn prepare_library_scan(
        &self,
        scan_id: i64,
        app: tauri::AppHandle,
    ) -> Result<LibraryReconciliation, LibraryError> {
        self.ensure_initialized().await?;
        self.reconciliation.start(scan_id, app).await
    }

    pub async fn cancel_library_reconciliation(
        &self,
        scan_id: i64,
    ) -> Result<LibraryReconciliation, LibraryError> {
        self.ensure_initialized().await?;
        self.reconciliation.cancel(scan_id).await
    }

    pub async fn get_library_reconciliation(
        &self,
        scan_id: i64,
    ) -> Result<LibraryReconciliation, LibraryError> {
        self.ensure_initialized().await?;
        self.reconciliation.get(scan_id).await
    }

    pub async fn apply_library_reconciliation(
        &self,
        scan_id: i64,
    ) -> Result<LibraryReconciliation, LibraryError> {
        self.ensure_initialized().await?;
        let reconciliation = self.reconciliation.apply(scan_id).await?;
        self.collect_artwork_cache().await;
        Ok(reconciliation)
    }

    pub(crate) async fn collect_artwork_cache(&self) {
        let Some(cache) = &self.artwork_cache else {
            return;
        };
        if let Err(error) = cache.collect(&self.repository.pool()).await {
            eprintln!("artwork cache collection failed: {error}");
        }
    }

    pub(crate) async fn ensure_initialized(&self) -> Result<(), LibraryError> {
        self.initialized
            .get_or_init(|| async {
                self.repository.initialize_schema().await?;
                self.scanner.recover_interrupted().await?;
                self.reconciliation.recover_interrupted().await
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
pub async fn query_facets(
    library: tauri::State<'_, LibraryState>,
    query: FacetQuery,
) -> Result<FacetPage, LibraryError> {
    library.query_facets(query).await
}

#[tauri::command]
pub async fn query_built_in_collection(
    library: tauri::State<'_, LibraryState>,
    query: BuiltInCollectionQuery,
) -> Result<BuiltInCollectionPage, LibraryError> {
    library.query_built_in_collection(query).await
}

#[tauri::command]
pub async fn create_playlist(
    library: tauri::State<'_, LibraryState>,
    name: String,
) -> Result<PlaylistSummary, LibraryError> {
    library.create_playlist(name).await
}

#[tauri::command]
pub async fn list_playlists(
    library: tauri::State<'_, LibraryState>,
    query: PlaylistQuery,
) -> Result<PlaylistPage, LibraryError> {
    library.list_playlists(query).await
}

#[tauri::command]
pub async fn rename_playlist(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
    name: String,
) -> Result<PlaylistSummary, LibraryError> {
    library.rename_playlist(playlist_id, name).await
}

#[tauri::command]
pub async fn delete_playlist(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
) -> Result<PlaylistMutation, LibraryError> {
    library.delete_playlist(playlist_id).await
}

#[tauri::command]
pub async fn duplicate_playlist(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
    name: String,
) -> Result<PlaylistSummary, LibraryError> {
    library.duplicate_playlist(playlist_id, name).await
}

#[tauri::command]
pub async fn add_playlist_entries(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
    song_ids: Vec<String>,
) -> Result<PlaylistMutation, LibraryError> {
    library.add_playlist_entries(playlist_id, song_ids).await
}

#[tauri::command]
pub async fn list_playlist_entries(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
    query: PlaylistEntryQuery,
) -> Result<PlaylistEntryPage, LibraryError> {
    library.list_playlist_entries(playlist_id, query).await
}

#[tauri::command]
pub async fn remove_playlist_entries(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
    entry_ids: Vec<String>,
) -> Result<PlaylistMutation, LibraryError> {
    library
        .remove_playlist_entries(playlist_id, entry_ids)
        .await
}

#[tauri::command]
pub async fn move_playlist_entry(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
    entry_id: String,
    direction: PlaylistMoveDirection,
) -> Result<PlaylistMutation, LibraryError> {
    library
        .move_playlist_entry(playlist_id, entry_id, direction)
        .await
}

#[tauri::command]
pub async fn create_smart_playlist(
    library: tauri::State<'_, LibraryState>,
    name: String,
    definition: SmartPlaylistDefinition,
) -> Result<SmartPlaylist, LibraryError> {
    library.create_smart_playlist(name, definition).await
}

#[tauri::command]
pub async fn get_smart_playlist(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
) -> Result<SmartPlaylist, LibraryError> {
    library.get_smart_playlist(playlist_id).await
}

#[tauri::command]
pub async fn update_smart_playlist(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
    name: String,
    definition: SmartPlaylistDefinition,
) -> Result<SmartPlaylist, LibraryError> {
    library
        .update_smart_playlist(playlist_id, name, definition)
        .await
}

#[tauri::command]
pub async fn delete_smart_playlist(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
) -> Result<PlaylistMutation, LibraryError> {
    library.delete_smart_playlist(playlist_id).await
}

#[tauri::command]
pub async fn query_smart_playlist(
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
    query: SmartPlaylistQuery,
) -> Result<SmartPlaylistPage, LibraryError> {
    library.query_smart_playlist(playlist_id, query).await
}

#[tauri::command]
pub async fn pick_m3u_import(
    app: tauri::AppHandle,
    library: tauri::State<'_, LibraryState>,
    imports: tauri::State<'_, M3uState>,
) -> Result<Option<M3uImportPreview>, LibraryError> {
    library.pick_m3u_import(app, imports.inner().clone()).await
}

#[tauri::command]
pub fn list_m3u_import_issues(
    imports: tauri::State<'_, M3uState>,
    token: String,
    query: M3uIssueQuery,
) -> Result<M3uIssuePage, LibraryError> {
    m3u::list_m3u_import_issues(imports.inner(), token, query)
}

#[tauri::command]
pub async fn apply_m3u_import(
    library: tauri::State<'_, LibraryState>,
    imports: tauri::State<'_, M3uState>,
    token: String,
    name: String,
) -> Result<M3uImportResult, LibraryError> {
    library.apply_m3u_import(imports.inner(), token, name).await
}

#[tauri::command]
pub fn discard_m3u_import(
    imports: tauri::State<'_, M3uState>,
    token: String,
) -> Result<bool, LibraryError> {
    m3u::discard_m3u_import(imports.inner(), token)
}

#[tauri::command]
pub async fn pick_m3u_export(
    app: tauri::AppHandle,
    library: tauri::State<'_, LibraryState>,
    playlist_id: String,
) -> Result<Option<M3uExportResult>, LibraryError> {
    library.pick_m3u_export(app, playlist_id).await
}

#[tauri::command]
pub async fn resolve_playback_tracks(
    library: tauri::State<'_, LibraryState>,
    track_ids: Vec<String>,
) -> Result<Vec<TrackSummary>, LibraryError> {
    library.resolve_playback_tracks(track_ids).await
}

#[tauri::command]
pub async fn query_storage(
    library: tauri::State<'_, LibraryState>,
    query: StorageQuery,
) -> Result<StoragePage, LibraryError> {
    library.query_storage(query).await
}

#[tauri::command]
pub async fn add_library_root(
    library: tauri::State<'_, LibraryState>,
    app: tauri::AppHandle,
    path: String,
) -> Result<LibraryRoot, LibraryError> {
    let root = library.add_library_root(path).await?;
    library
        .sync_library_root_watcher(root.id, app, true)
        .await?;
    library.get_library_root(root.id).await
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
    app: tauri::AppHandle,
    id: i64,
    enabled: bool,
) -> Result<LibraryRoot, LibraryError> {
    library.set_library_root_enabled(id, enabled).await?;
    library.sync_library_root_watcher(id, app, enabled).await?;
    library.get_library_root(id).await
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

#[tauri::command]
pub async fn prepare_library_scan(
    library: tauri::State<'_, LibraryState>,
    app: tauri::AppHandle,
    scan_id: i64,
) -> Result<LibraryReconciliation, LibraryError> {
    library.prepare_library_scan(scan_id, app).await
}

#[tauri::command]
pub async fn cancel_library_reconciliation(
    library: tauri::State<'_, LibraryState>,
    scan_id: i64,
) -> Result<LibraryReconciliation, LibraryError> {
    library.cancel_library_reconciliation(scan_id).await
}

#[tauri::command]
pub async fn get_library_reconciliation(
    library: tauri::State<'_, LibraryState>,
    scan_id: i64,
) -> Result<LibraryReconciliation, LibraryError> {
    library.get_library_reconciliation(scan_id).await
}

#[tauri::command]
pub async fn apply_library_reconciliation(
    library: tauri::State<'_, LibraryState>,
    scan_id: i64,
) -> Result<LibraryReconciliation, LibraryError> {
    library.apply_library_reconciliation(scan_id).await
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

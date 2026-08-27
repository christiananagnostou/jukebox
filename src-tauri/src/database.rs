pub(crate) const LATEST_SCHEMA_VERSION: i64 = 15;

#[cfg(test)]
pub(crate) const INITIAL_SCHEMA: &str = include_str!("../migrations/0001_initial.sql");
#[cfg(test)]
pub(crate) const CATALOG_QUERY_SCHEMA: &str = include_str!("../migrations/0002_catalog_query.sql");
#[cfg(test)]
pub(crate) const LIBRARY_SCAN_SCHEMA: &str =
    include_str!("../migrations/0003_library_scan_state.sql");
#[cfg(test)]
pub(crate) const LIBRARY_DISCOVERY_SCHEMA: &str =
    include_str!("../migrations/0004_library_scan_discovery.sql");
#[cfg(test)]
pub(crate) const LIBRARY_METADATA_SCHEMA: &str =
    include_str!("../migrations/0005_library_scan_metadata.sql");
#[cfg(test)]
pub(crate) const LIBRARY_RECONCILIATION_SCHEMA: &str =
    include_str!("../migrations/0006_library_scan_reconciliation.sql");
#[cfg(test)]
pub(crate) const LIBRARY_REFRESH_SCHEMA: &str =
    include_str!("../migrations/0007_library_refresh_runs.sql");
#[cfg(test)]
pub(crate) const LIBRARY_STORAGE_SCHEMA: &str =
    include_str!("../migrations/0008_library_storage_nodes.sql");
#[cfg(test)]
pub(crate) const PLAYBACK_SESSION_SCHEMA: &str =
    include_str!("../migrations/0009_playback_session.sql");
#[cfg(test)]
pub(crate) const LIBRARY_FILTERS_SCHEMA: &str =
    include_str!("../migrations/0010_library_filters_facets.sql");
#[cfg(test)]
pub(crate) const PLAYLIST_SCHEMA: &str = include_str!("../migrations/0011_playlists.sql");
#[cfg(test)]
pub(crate) const PLAY_HISTORY_SCHEMA: &str =
    include_str!("../migrations/0012_listening_history.sql");
#[cfg(test)]
pub(crate) const HISTORY_COLLECTION_SCHEMA: &str =
    include_str!("../migrations/0013_history_collection_index.sql");
#[cfg(test)]
pub(crate) const SMART_PLAYLIST_SCHEMA: &str =
    include_str!("../migrations/0014_smart_playlists.sql");
#[cfg(test)]
pub(crate) const PLAYLIST_PATH_LOOKUP_SCHEMA: &str =
    include_str!("../migrations/0015_playlist_path_lookup.sql");
pub(crate) static NATIVE_MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    const PRE_0002_FIXTURE: &str = r#"
        INSERT INTO songs VALUES
          ('01', '/Music/Björk/Jóga.flac', 'Jóga.flac', 'Jóga', 'Homogenic', 'Björk', 'Electronic', 90, 0, '1997', 'encoder', 10, 2, 'flac', '0:05:05.000', '44100', 1, 0, 0, '2025-01-01', ''),
          ('02', '/Music/Björk/All Is Full of Love.flac', 'All Is Full of Love.flac', 'All Is Full of Love', 'Homogenic', 'Björk', 'Electronic', 72, 0, '1997', 'encoder', 10, 10, 'flac', '0:04:32.000', '48000', 1, 0, 1, '2025-01-02', ''),
          ('03', '/Music/Various/Intro A.flac', 'Intro A.flac', 'Intro', 'Duplicate Album', 'Álvaro', '', 0, 1, '2020', 'encoder', 4, 1, 'flac', '0:01:00.000', '44100', 1, 0, 2, '2025-02-01', ''),
          ('04', '/Music/Various/Intro B.flac', 'Intro B.flac', 'Intro', 'Duplicate Album', 'Álvaro', '', 0, 1, '2020', 'encoder', 4, 1, 'flac', '0:01:01.000', '44100', 2, 0, 1, '2025-02-02', ''),
          ('05', '/Music/Percent/100_percent.flac', '100_percent.flac', '100% Real', 'Symbols_%', 'Test Artist', '', 0, 0, '2026', 'encoder', 1, 1, 'flac', '0:02:00.000', '96000', 1, 0, 0, '2025-03-01', '');
    "#;

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn initial_schema_creates_the_expected_table() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");

            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");

            let columns: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('songs') WHERE name IN ('id', 'path', 'title', 'favorRating', 'visualsPath')",
            )
            .fetch_one(&pool)
            .await
            .expect("inspect songs schema");

            assert_eq!(columns, 5);
        });
    }

    #[test]
    fn initial_schema_is_safe_for_existing_databases() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");

            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("reapply initial schema");

            let tables: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'songs'",
            )
            .fetch_one(&pool)
            .await
            .expect("count songs tables");

            assert_eq!(tables, 1);
        });
    }

    #[test]
    fn favorite_rating_constraint_rejects_invalid_values() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");

            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");

            let result = sqlx::query(
                "INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind("id")
            .bind("/music")
            .bind("track.flac")
            .bind("Track")
            .bind("Album")
            .bind("Artist")
            .bind("")
            .bind(0_i64)
            .bind(0_i64)
            .bind("")
            .bind("")
            .bind(1_i64)
            .bind(1_i64)
            .bind("FLAC")
            .bind("0")
            .bind("44100")
            .bind(0_i64)
            .bind(0_i64)
            .bind(3_i64)
            .bind("2026-01-01")
            .bind("")
            .execute(&pool)
            .await;

            assert!(result.is_err());
        });
    }

    #[test]
    fn catalog_query_schema_upgrades_existing_rows_without_loss_and_supports_fts5() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");
            sqlx::raw_sql(PRE_0002_FIXTURE)
                .execute(&pool)
                .await
                .expect("load pre-0002 fixture");

            NATIVE_MIGRATOR
                .run(&pool)
                .await
                .expect("upgrade fixture with bundled FTS5");

            let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM songs")
                .fetch_one(&pool)
                .await
                .expect("count preserved rows");
            let rating_sum: i64 = sqlx::query_scalar("SELECT SUM(favorRating) FROM songs")
                .fetch_one(&pool)
                .await
                .expect("sum preserved ratings");
            let unicode_match: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH ?")
                    .bind(r#""Björk""#)
                    .fetch_one(&pool)
                    .await
                    .expect("search Unicode metadata");
            let wildcard_like_match: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH ?")
                    .bind(r#""100""#)
                    .fetch_one(&pool)
                    .await
                    .expect("search wildcard-like metadata");
            let genre_match: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH ?")
                    .bind(r#""Electronic""#)
                    .fetch_one(&pool)
                    .await
                    .expect("search indexed genre metadata");

            assert_eq!(row_count, 5);
            assert_eq!(rating_sum, 4);
            assert_eq!(unicode_match, 2);
            assert_eq!(wildcard_like_match, 1);
            assert_eq!(genre_match, 2);
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read initial revision"),
                0
            );

            NATIVE_MIGRATOR
                .run(&pool)
                .await
                .expect("reapply catalog schema");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs_fts")
                    .fetch_one(&pool)
                    .await
                    .expect("count fts rows"),
                5
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1"
                )
                .fetch_one(&pool)
                .await
                .expect("count applied migrations"),
                LATEST_SCHEMA_VERSION
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'index'
                       AND name IN (
                         'idx_songs_genre_filter', 'idx_songs_codec_filter',
                         'idx_songs_year_filter', 'idx_songs_availability_filter'
                       )",
                )
                .fetch_one(&pool)
                .await
                .expect("inspect facet indexes"),
                4
            );
            sqlx::query("UPDATE songs SET genre = 'Downtempo' WHERE id = '01'")
                .execute(&pool)
                .await
                .expect("update indexed genre");
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH 'downtempo'"
                )
                .fetch_one(&pool)
                .await
                .expect("confirm genre trigger refresh"),
                1
            );
            let scan_columns: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('songs') WHERE name IN (
                    'root_id', 'normalized_path', 'file_size', 'modified_at_ns',
                    'quick_fingerprint', 'availability', 'last_seen_scan_id', 'metadata_version'
                )",
            )
            .fetch_one(&pool)
            .await
            .expect("inspect scan columns");
            let available_rows: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM songs WHERE availability = 'available'")
                    .fetch_one(&pool)
                    .await
                    .expect("count available migrated rows");

            assert_eq!(scan_columns, 8);
            assert_eq!(available_rows, 5);
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table' AND name = 'library_scan_files'",
                )
                .fetch_one(&pool)
                .await
                .expect("inspect discovery staging table"),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table' AND name = 'playback_session'",
                )
                .fetch_one(&pool)
                .await
                .expect("inspect playback session table"),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table' AND name = 'library_refresh_runs'",
                )
                .fetch_one(&pool)
                .await
                .expect("inspect refresh run table"),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table'
                       AND name IN ('library_reconciliations', 'library_scan_metadata')",
                )
                .fetch_one(&pool)
                .await
                .expect("inspect metadata staging tables"),
                2
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM pragma_table_info('library_scan_metadata')
                     WHERE name = 'matched_song_id'",
                )
                .fetch_one(&pool)
                .await
                .expect("inspect reconciliation match column"),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'index' AND name = 'idx_songs_root_fingerprint'",
                )
                .fetch_one(&pool)
                .await
                .expect("inspect reconciliation fingerprint index"),
                1
            );
        });
    }

    #[test]
    fn playlist_schema_preserves_collection_intent_without_a_song_foreign_key() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open playlist migration database");
            sqlx::query("PRAGMA foreign_keys = ON")
                .execute(&pool)
                .await
                .expect("enable playlist foreign keys");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial playlist schema");
            sqlx::raw_sql(PLAYLIST_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply playlist schema");
            sqlx::raw_sql(
                "INSERT INTO songs VALUES
                  ('song', '/Music/song.flac', 'song.flac', 'Song', 'Album', 'Artist', '', 0, 0,
                   '2026', '', 1, 1, 'flac', '0:03:00.000', '44100', 1, 0, 0,
                   '2026-08-27', '');
                 INSERT INTO playlists (id, name, name_key) VALUES
                  ('playlist_0123456789abcdef0123456789abcdef', 'Saved', 'saved');
                 INSERT INTO playlist_entries (
                   id, playlist_id, song_id, position, title_snapshot, artist_snapshot,
                   album_snapshot
                 ) VALUES (
                   'entry_0123456789abcdef0123456789abcdef',
                   'playlist_0123456789abcdef0123456789abcdef', 'song', 0,
                   'Song', 'Artist', 'Album'
                 );
                 DELETE FROM songs WHERE id = 'song';",
            )
            .execute(&pool)
            .await
            .expect("preserve entry across catalog deletion");

            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM playlist_entries")
                    .fetch_one(&pool)
                    .await
                    .expect("count preserved playlist entry"),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM pragma_foreign_key_list('playlist_entries')
                     WHERE \"table\" = 'playlists' AND \"from\" = 'playlist_id'"
                )
                .fetch_one(&pool)
                .await
                .expect("inspect playlist ownership foreign key"),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM pragma_foreign_key_list('playlist_entries')
                     WHERE \"table\" = 'songs'"
                )
                .fetch_one(&pool)
                .await
                .expect("confirm song foreign key is absent"),
                0
            );
            sqlx::query(
                "DELETE FROM playlists WHERE id = 'playlist_0123456789abcdef0123456789abcdef'",
            )
            .execute(&pool)
            .await
            .expect("delete playlist owner");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM playlist_entries")
                    .fetch_one(&pool)
                    .await
                    .expect("confirm playlist cascade"),
                0
            );
        });
    }

    #[test]
    fn play_history_schema_preserves_snapshots_and_allows_only_one_open_row() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open history migration database");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial history schema");
            sqlx::raw_sql(PLAY_HISTORY_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply history schema");
            sqlx::raw_sql(
                "INSERT INTO songs VALUES
                  ('song', '/Music/song.flac', 'song.flac', 'Song', 'Album', 'Artist', '', 0, 0,
                   '2026', '', 1, 1, 'flac', '0:03:00.000', '44100', 1, 0, 0,
                   '2026-08-27', '');
                 INSERT INTO play_history (
                   track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind
                 ) VALUES ('song', 'Song', 'Artist', 'Album', 'context');
                 DELETE FROM songs WHERE id = 'song';",
            )
            .execute(&pool)
            .await
            .expect("preserve history across catalog deletion");

            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT title_snapshot FROM play_history")
                    .fetch_one(&pool)
                    .await
                    .expect("read preserved history snapshot"),
                "Song"
            );
            assert!(sqlx::query(
                "INSERT INTO play_history (
                   track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind
                 ) VALUES ('other', 'Other', '', '', 'queue')"
            )
            .execute(&pool)
            .await
            .is_err());
            sqlx::query(
                "UPDATE play_history
                 SET ended_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'), open_slot = NULL
                 WHERE open_slot = 1",
            )
            .execute(&pool)
            .await
            .expect("close first history row");
            sqlx::query(
                "INSERT INTO play_history (
                   track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind
                 ) VALUES ('other', 'Other', '', '', 'queue')",
            )
            .execute(&pool)
            .await
            .expect("insert next open history row");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM play_history")
                    .fetch_one(&pool)
                    .await
                    .expect("count history rows"),
                2
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM pragma_foreign_key_list('play_history')"
                )
                .fetch_one(&pool)
                .await
                .expect("confirm history has no catalog foreign key"),
                0
            );
        });
    }

    #[test]
    fn history_collection_index_covers_completed_plays_by_track() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open history collection migration database");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial history collection schema");
            sqlx::raw_sql(PLAY_HISTORY_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply history schema");
            sqlx::raw_sql(HISTORY_COLLECTION_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply history collection schema");

            let definition: String = sqlx::query_scalar(
                "SELECT sql FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_play_history_completed_track'",
            )
            .fetch_one(&pool)
            .await
            .expect("inspect completed history index");
            assert!(definition.contains("track_id, started_at DESC, id DESC"));
            assert!(definition.contains("WHERE completed = 1"));
        });
    }

    #[test]
    fn smart_playlist_schema_preserves_manual_rows_and_cascades_only_owned_rules() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open smart playlist migration database");
            sqlx::query("PRAGMA foreign_keys = ON")
                .execute(&pool)
                .await
                .expect("enable foreign keys");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");
            sqlx::raw_sql(PLAYLIST_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply playlist schema");
            sqlx::query(
                "INSERT INTO playlists (id, name, name_key, kind)
                 VALUES ('playlist_manual', 'Manual', 'manual', 'manual'),
                        ('playlist_smart', 'Smart', 'smart', 'smart')",
            )
            .execute(&pool)
            .await
            .expect("insert pre-migration playlists");

            sqlx::raw_sql(SMART_PLAYLIST_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply smart playlist schema");
            sqlx::query(
                "INSERT INTO smart_playlist_rules (playlist_id, version, rule_json)
                 VALUES ('playlist_smart', 1, '{}')",
            )
            .execute(&pool)
            .await
            .expect("insert smart rule document");

            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM playlists")
                    .fetch_one(&pool)
                    .await
                    .expect("count preserved playlists"),
                2
            );
            assert!(sqlx::query(
                "INSERT INTO smart_playlist_rules (playlist_id, version, rule_json)
                 VALUES ('playlist_manual', 1, '{}')"
            )
            .execute(&pool)
            .await
            .is_err());

            sqlx::query("DELETE FROM playlists WHERE id = 'playlist_smart'")
                .execute(&pool)
                .await
                .expect("delete smart playlist");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM smart_playlist_rules")
                    .fetch_one(&pool)
                    .await
                    .expect("count cascaded smart rules"),
                0
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM playlists WHERE id = 'playlist_manual'"
                )
                .fetch_one(&pool)
                .await
                .expect("confirm manual playlist remains"),
                1
            );
        });
    }

    #[test]
    fn scan_state_constraints_preserve_catalog_and_ignore_bookkeeping_updates() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");
            sqlx::raw_sql(CATALOG_QUERY_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply catalog schema");
            sqlx::raw_sql(PRE_0002_FIXTURE)
                .execute(&pool)
                .await
                .expect("insert fixture through catalog triggers");
            sqlx::raw_sql(LIBRARY_SCAN_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply scan schema");

            let root_id: i64 = sqlx::query_scalar(
                "INSERT INTO library_roots (path, canonical_path) VALUES (?, ?) RETURNING id",
            )
            .bind("/Music")
            .bind("/Music")
            .fetch_one(&pool)
            .await
            .expect("insert root");
            let scan_id: i64 = sqlx::query_scalar(
                "INSERT INTO library_scans (root_id, status) VALUES (?, 'running') RETURNING id",
            )
            .bind(root_id)
            .fetch_one(&pool)
            .await
            .expect("insert scan");

            sqlx::query(
                "UPDATE songs SET
                    root_id = ?, normalized_path = ?, file_size = ?, modified_at_ns = ?,
                    quick_fingerprint = ?, last_seen_scan_id = ?, metadata_version = ?
                 WHERE id = '01'",
            )
            .bind(root_id)
            .bind("Björk/Jóga.flac")
            .bind(123_i64)
            .bind(456_i64)
            .bind("fingerprint")
            .bind(scan_id)
            .bind(2_i64)
            .execute(&pool)
            .await
            .expect("update scan bookkeeping");

            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read unchanged revision"),
                5
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs_fts")
                    .fetch_one(&pool)
                    .await
                    .expect("count unchanged search rows"),
                5
            );

            sqlx::query("UPDATE songs SET availability = 'unavailable' WHERE id = '01'")
                .execute(&pool)
                .await
                .expect("mark song unavailable");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read visibility revision"),
                6
            );

            let invalid_counter =
                sqlx::query("UPDATE library_scans SET discovered = -1 WHERE id = ?")
                    .bind(scan_id)
                    .execute(&pool)
                    .await;
            let invalid_status =
                sqlx::query("INSERT INTO library_scans (root_id, status) VALUES (?, 'unknown')")
                    .bind(root_id)
                    .execute(&pool)
                    .await;
            let unknown_root = sqlx::query("UPDATE songs SET root_id = 999 WHERE id = '02'")
                .execute(&pool)
                .await;
            assert!(invalid_counter.is_err());
            assert!(invalid_status.is_err());
            assert!(unknown_root.is_err());

            sqlx::query("UPDATE library_roots SET enabled = 0 WHERE id = ?")
                .bind(root_id)
                .execute(&pool)
                .await
                .expect("disable root");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs")
                    .fetch_one(&pool)
                    .await
                    .expect("count songs after disabling root"),
                5
            );
        });
    }

    #[test]
    fn catalog_triggers_advance_revision_and_keep_search_in_sync() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");
            sqlx::raw_sql(CATALOG_QUERY_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply catalog schema");

            sqlx::raw_sql(PRE_0002_FIXTURE)
                .execute(&pool)
                .await
                .expect("insert fixture through triggers");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read insert revision"),
                5
            );

            sqlx::query("UPDATE songs SET title = ? WHERE id = ?")
                .bind("Changed Title")
                .bind("01")
                .execute(&pool)
                .await
                .expect("update song");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read update revision"),
                6
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH 'changed'"
                )
                .fetch_one(&pool)
                .await
                .expect("find updated title"),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH 'title:jóga'"
                )
                .fetch_one(&pool)
                .await
                .expect("confirm old title removed"),
                0
            );

            sqlx::query("DELETE FROM songs WHERE id = ?")
                .bind("01")
                .execute(&pool)
                .await
                .expect("delete song");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read delete revision"),
                7
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs_fts WHERE song_id = '01'")
                    .fetch_one(&pool)
                    .await
                    .expect("confirm deleted fts row"),
                0
            );
        });
    }

    #[test]
    fn playlist_path_lookup_schema_adds_exact_and_case_insensitive_indexes() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");
            sqlx::raw_sql(CATALOG_QUERY_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply catalog query schema");
            sqlx::raw_sql(LIBRARY_SCAN_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply library scan schema");
            sqlx::raw_sql(PLAYLIST_PATH_LOOKUP_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply playlist path lookup schema");

            let index_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_songs_path_lookup', 'idx_songs_path_lookup_nocase')",
            )
            .fetch_one(&pool)
            .await
            .expect("inspect playlist path lookup indexes");

            assert_eq!(index_count, 2);
        });
    }
}

use crate::library::LibraryState;
use serde::Deserialize;
#[cfg(test)]
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::BTreeSet;
#[cfg(test)]
use std::path::PathBuf;
#[cfg(test)]
use std::time::Duration;

const UPSERT_CHUNK_SIZE: usize = 100;
const DELETE_CHUNK_SIZE: usize = 200;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSongInput {
    id: String,
    path: String,
    file: String,
    title: String,
    album: String,
    artist: String,
    genre: String,
    bpm: i64,
    compilation: i64,
    date: String,
    encoder: String,
    track_total: i64,
    track_number: i64,
    codec: String,
    duration: String,
    sample_rate: String,
    side: i64,
    start_time: i64,
    favor_rating: i64,
    date_added: String,
    visuals_path: String,
}

impl LibraryState {
    async fn catalog_mutation_pool(&self) -> Result<SqlitePool, String> {
        self.ensure_initialized()
            .await
            .map_err(|error| error.message)?;
        Ok(self.pool())
    }

    async fn upsert_catalog_songs(&self, songs: &[CatalogSongInput]) -> Result<(), String> {
        if songs.is_empty() {
            return Ok(());
        }
        upsert_songs_in_pool(&self.catalog_mutation_pool().await?, songs, |_| Ok(())).await?;
        self.collect_artwork_cache().await;
        Ok(())
    }

    async fn delete_catalog_songs(&self, ids: &[String]) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        delete_songs_in_pool(&self.catalog_mutation_pool().await?, ids, |_| Ok(())).await?;
        self.collect_artwork_cache().await;
        Ok(())
    }

    async fn clear_catalog_songs(&self) -> Result<(), String> {
        clear_songs_in_pool(&self.catalog_mutation_pool().await?).await?;
        self.collect_artwork_cache().await;
        Ok(())
    }

    async fn set_favorite_rating(&self, id: &str, rating: i64) -> Result<(), String> {
        if !(0..=2).contains(&rating) {
            return Err("Favorite rating must be between 0 and 2.".to_string());
        }
        update_favorite_rating_in_pool(&self.catalog_mutation_pool().await?, id, rating).await
    }
}

#[tauri::command]
pub async fn upsert_songs(
    library: tauri::State<'_, LibraryState>,
    songs: Vec<CatalogSongInput>,
) -> Result<(), String> {
    library.upsert_catalog_songs(&songs).await
}

#[tauri::command]
pub async fn delete_songs(
    library: tauri::State<'_, LibraryState>,
    ids: Vec<String>,
) -> Result<(), String> {
    library.delete_catalog_songs(&ids).await
}

#[tauri::command]
pub async fn clear_library_songs(library: tauri::State<'_, LibraryState>) -> Result<(), String> {
    library.clear_catalog_songs().await
}

#[tauri::command]
pub async fn update_favorite_rating(
    library: tauri::State<'_, LibraryState>,
    id: String,
    rating: i64,
) -> Result<(), String> {
    library.set_favorite_rating(&id, rating).await
}

#[cfg(test)]
async fn open_pool(path: PathBuf, create_if_missing: bool) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(create_if_missing)
        .busy_timeout(Duration::from_secs(5));

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
}

async fn update_favorite_rating_in_pool(
    pool: &SqlitePool,
    id: &str,
    rating: i64,
) -> Result<(), String> {
    if !(0..=2).contains(&rating) {
        return Err("Favorite rating must be between 0 and 2.".to_string());
    }

    let result = sqlx::query("UPDATE songs SET favorRating = ? WHERE id = ?")
        .bind(rating)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| format!("Could not update favorite rating: {error}"))?;
    if result.rows_affected() == 0 {
        return Err("The selected track is no longer in the library.".to_string());
    }
    Ok(())
}

async fn upsert_songs_in_pool<F>(
    pool: &SqlitePool,
    songs: &[CatalogSongInput],
    mut after_chunk: F,
) -> Result<(), String>
where
    F: FnMut(usize) -> Result<(), String>,
{
    if songs.is_empty() {
        return Ok(());
    }

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Could not start library update: {error}"))?;

    for (chunk_index, chunk) in songs.chunks(UPSERT_CHUNK_SIZE).enumerate() {
        let mut query = QueryBuilder::<Sqlite>::new(
            "INSERT INTO songs (
                id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
                trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
                favorRating, dateAdded, visualsPath
            ) ",
        );
        query.push_values(chunk, |mut row, song| {
            row.push_bind(&song.id)
                .push_bind(&song.path)
                .push_bind(&song.file)
                .push_bind(&song.title)
                .push_bind(&song.album)
                .push_bind(&song.artist)
                .push_bind(&song.genre)
                .push_bind(song.bpm)
                .push_bind(song.compilation)
                .push_bind(&song.date)
                .push_bind(&song.encoder)
                .push_bind(song.track_total)
                .push_bind(song.track_number)
                .push_bind(&song.codec)
                .push_bind(&song.duration)
                .push_bind(&song.sample_rate)
                .push_bind(song.side)
                .push_bind(song.start_time)
                .push_bind(song.favor_rating)
                .push_bind(&song.date_added)
                .push_bind(&song.visuals_path);
        });
        query.push(
            " ON CONFLICT(id) DO UPDATE SET
                path = excluded.path,
                file = excluded.file,
                title = excluded.title,
                album = excluded.album,
                artist = excluded.artist,
                genre = excluded.genre,
                bpm = excluded.bpm,
                compilation = excluded.compilation,
                date = excluded.date,
                encoder = excluded.encoder,
                trackTotal = excluded.trackTotal,
                trackNumber = excluded.trackNumber,
                codec = excluded.codec,
                duration = excluded.duration,
                sampleRate = excluded.sampleRate,
                side = excluded.side,
                visualsPath = excluded.visualsPath",
        );
        query
            .build()
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("Could not update library: {error}"))?;
        after_chunk(chunk_index + 1)?;
    }

    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit library update: {error}"))
}

async fn delete_songs_in_pool<F>(
    pool: &SqlitePool,
    ids: &[String],
    mut after_chunk: F,
) -> Result<(), String>
where
    F: FnMut(usize) -> Result<(), String>,
{
    if ids.is_empty() {
        return Ok(());
    }

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Could not start library deletion: {error}"))?;
    let mut affected_roots = BTreeSet::new();

    for (chunk_index, chunk) in ids.chunks(DELETE_CHUNK_SIZE).enumerate() {
        let mut roots = QueryBuilder::<Sqlite>::new(
            "SELECT DISTINCT root_id FROM songs WHERE root_id IS NOT NULL AND id IN (",
        );
        let mut separated = roots.separated(", ");
        for id in chunk {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
        for row in roots
            .build()
            .fetch_all(&mut *transaction)
            .await
            .map_err(|error| format!("Could not inspect library deletion: {error}"))?
        {
            affected_roots.insert(
                row.try_get::<i64, _>("root_id")
                    .map_err(|error| format!("Could not inspect library deletion: {error}"))?,
            );
        }

        let mut query = QueryBuilder::<Sqlite>::new("DELETE FROM songs WHERE id IN (");
        let mut separated = query.separated(", ");
        for id in chunk {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
        query
            .build()
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("Could not delete library songs: {error}"))?;
        after_chunk(chunk_index + 1)?;
    }

    for root_id in affected_roots {
        crate::library::storage::rebuild_storage_index(&mut transaction, root_id)
            .await
            .map_err(|_| "Could not update the storage index after deletion.".to_owned())?;
    }

    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit library deletion: {error}"))
}

async fn clear_songs_in_pool(pool: &SqlitePool) -> Result<(), String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Could not start library clear: {error}"))?;
    sqlx::query("DELETE FROM library_storage_nodes")
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not clear storage index: {error}"))?;
    sqlx::query("DELETE FROM songs")
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not clear library: {error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit library clear: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    async fn test_pool(label: &str) -> (SqlitePool, PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "jukebox-catalog-{label}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create isolated database directory");
        let pool = open_pool(root.join("library.db"), true)
            .await
            .expect("open isolated library database");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate isolated library database");
        (pool, root)
    }

    async fn close_test_pool(pool: SqlitePool, root: PathBuf) {
        pool.close().await;
        drop(pool);
        std::fs::remove_dir_all(root).expect("remove isolated database directory");
    }

    fn song(index: usize) -> CatalogSongInput {
        CatalogSongInput {
            id: format!("song-{index}"),
            path: format!("/music/song-{index}.flac"),
            file: format!("song-{index}.flac"),
            title: format!("Song {index}"),
            album: "Album".to_string(),
            artist: "Artist".to_string(),
            genre: "Genre".to_string(),
            bpm: 120,
            compilation: 0,
            date: "2026".to_string(),
            encoder: "encoder".to_string(),
            track_total: 300,
            track_number: index as i64,
            codec: "flac".to_string(),
            duration: "0:03:00.000".to_string(),
            sample_rate: "44100".to_string(),
            side: 1,
            start_time: 0,
            favor_rating: 0,
            date_added: "2026-08-26T00:00:00.000Z".to_string(),
            visuals_path: String::new(),
        }
    }

    async fn song_count(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM songs")
            .fetch_one(pool)
            .await
            .expect("count songs")
    }

    #[test]
    fn upserts_across_the_chunk_boundary_and_preserves_user_fields() {
        run_async(async {
            let (pool, root) = test_pool("upsert-boundary").await;
            let mut songs = (0..=UPSERT_CHUNK_SIZE).map(song).collect::<Vec<_>>();
            upsert_songs_in_pool(&pool, &songs, |_| Ok(()))
                .await
                .expect("insert songs");
            assert_eq!(song_count(&pool).await, 101);

            sqlx::query(
                "UPDATE songs SET startTime = 42, favorRating = 2, dateAdded = 'original' WHERE id = 'song-0'",
            )
            .execute(&pool)
            .await
            .expect("set user fields");
            songs[0].title = "Updated".to_string();
            songs[0].start_time = 0;
            songs[0].favor_rating = 0;
            songs[0].date_added = "replacement".to_string();
            upsert_songs_in_pool(&pool, &songs[..1], |_| Ok(()))
                .await
                .expect("update song");

            let row: (String, i64, i64, String) = sqlx::query_as(
                "SELECT title, startTime, favorRating, dateAdded FROM songs WHERE id = 'song-0'",
            )
            .fetch_one(&pool)
            .await
            .expect("read updated song");
            assert_eq!(row, ("Updated".to_string(), 42, 2, "original".to_string()));
            close_test_pool(pool, root).await;
        });
    }

    #[test]
    fn failed_middle_upsert_rolls_back_every_chunk() {
        run_async(async {
            let (pool, root) = test_pool("upsert-rollback").await;
            upsert_songs_in_pool(&pool, &[song(999)], |_| Ok(()))
                .await
                .expect("insert pre-operation song");
            let songs = (0..=UPSERT_CHUNK_SIZE).map(song).collect::<Vec<_>>();
            let error = upsert_songs_in_pool(&pool, &songs, |completed| {
                if completed == 1 {
                    Err("injected upsert failure".to_string())
                } else {
                    Ok(())
                }
            })
            .await
            .expect_err("injected failure should abort the transaction");

            assert_eq!(error, "injected upsert failure");
            assert_eq!(song_count(&pool).await, 1);
            let remaining: String = sqlx::query_scalar("SELECT id FROM songs")
                .fetch_one(&pool)
                .await
                .expect("read pre-operation song");
            assert_eq!(remaining, "song-999");
            close_test_pool(pool, root).await;
        });
    }

    #[test]
    fn favorite_updates_validate_rating_and_existing_track() {
        run_async(async {
            let (pool, root) = test_pool("favorite-update").await;
            upsert_songs_in_pool(&pool, &[song(1)], |_| Ok(()))
                .await
                .expect("insert song");

            update_favorite_rating_in_pool(&pool, "song-1", 2)
                .await
                .expect("update favorite");
            let rating: i64 =
                sqlx::query_scalar("SELECT favorRating FROM songs WHERE id = 'song-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("read favorite");
            assert_eq!(rating, 2);
            assert!(update_favorite_rating_in_pool(&pool, "song-1", 3)
                .await
                .expect_err("invalid rating should fail")
                .contains("between 0 and 2"));
            assert!(update_favorite_rating_in_pool(&pool, "missing", 1)
                .await
                .expect_err("missing song should fail")
                .contains("no longer in the library"));

            close_test_pool(pool, root).await;
        });
    }

    #[test]
    fn managed_library_state_runs_every_catalog_mutation() {
        run_async(async {
            let (pool, root) = test_pool("managed-mutations").await;
            let artwork_root = root.join("art");
            let cache = crate::artwork::ArtworkCache::from_root(artwork_root.clone());
            let referenced_artwork = cache
                .cache("image/png", b"referenced")
                .expect("cache referenced artwork")
                .expect("referenced artwork path");
            let abandoned_artwork = cache
                .cache("image/png", b"abandoned")
                .expect("cache abandoned artwork")
                .expect("abandoned artwork path");
            let library = LibraryState::from_pool_with_artwork_root(pool.clone(), artwork_root);
            let mut songs = vec![song(1), song(2)];
            songs[0].visuals_path = referenced_artwork.to_string_lossy().into_owned();

            library
                .upsert_catalog_songs(&songs)
                .await
                .expect("upsert through managed state");
            assert!(referenced_artwork.is_file());
            assert!(!abandoned_artwork.exists());
            library
                .set_favorite_rating("song-1", 2)
                .await
                .expect("update favorite through managed state");
            library
                .delete_catalog_songs(&["song-2".to_string()])
                .await
                .expect("delete through managed state");

            let row: (i64, i64) =
                sqlx::query_as("SELECT COUNT(*), MAX(favorRating) FROM songs WHERE id = 'song-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("read managed mutation result");
            assert_eq!(row, (1, 2));

            library
                .clear_catalog_songs()
                .await
                .expect("clear through managed state");
            assert_eq!(song_count(&pool).await, 0);
            assert!(!referenced_artwork.exists());

            drop(library);
            close_test_pool(pool, root).await;
        });
    }

    #[test]
    fn deserializes_the_existing_typescript_song_shape() {
        let value = serde_json::json!({
            "id": "song",
            "path": "/music/song.flac",
            "file": "song.flac",
            "title": "Song",
            "album": "Album",
            "artist": "Artist",
            "genre": "Genre",
            "bpm": 120,
            "compilation": 0,
            "date": "2026",
            "encoder": "encoder",
            "trackTotal": 1,
            "trackNumber": 1,
            "codec": "flac",
            "duration": "0:03:00.000",
            "sampleRate": "44100",
            "side": 1,
            "startTime": 0,
            "favorRating": 2,
            "dateAdded": "2026-08-26T00:00:00.000Z",
            "visualsPath": ""
        });

        let input: CatalogSongInput = serde_json::from_value(value).expect("deserialize Song");

        assert_eq!(input.id, "song");
        assert_eq!(input.track_total, 1);
        assert_eq!(input.sample_rate, "44100");
        assert_eq!(input.favor_rating, 2);
    }

    #[test]
    fn deletes_across_the_chunk_boundary_and_rolls_back_a_middle_failure() {
        run_async(async {
            let (pool, root) = test_pool("delete-boundary").await;
            let songs = (0..=DELETE_CHUNK_SIZE).map(song).collect::<Vec<_>>();
            upsert_songs_in_pool(&pool, &songs, |_| Ok(()))
                .await
                .expect("insert songs");
            let ids = songs.iter().map(|song| song.id.clone()).collect::<Vec<_>>();

            let error = delete_songs_in_pool(&pool, &ids, |completed| {
                if completed == 1 {
                    Err("injected delete failure".to_string())
                } else {
                    Ok(())
                }
            })
            .await
            .expect_err("injected failure should abort the transaction");
            assert_eq!(error, "injected delete failure");
            assert_eq!(song_count(&pool).await, 201);

            delete_songs_in_pool(&pool, &ids, |_| Ok(()))
                .await
                .expect("delete songs");
            assert_eq!(song_count(&pool).await, 0);
            close_test_pool(pool, root).await;
        });
    }

    #[test]
    fn empty_mutations_are_noops_and_clear_is_atomic() {
        run_async(async {
            let (pool, root) = test_pool("empty-and-clear").await;
            upsert_songs_in_pool(&pool, &[song(1)], |_| Ok(()))
                .await
                .expect("insert song");
            upsert_songs_in_pool(&pool, &[], |_| Ok(()))
                .await
                .expect("empty upsert");
            delete_songs_in_pool(&pool, &[], |_| Ok(()))
                .await
                .expect("empty delete");
            assert_eq!(song_count(&pool).await, 1);

            clear_songs_in_pool(&pool).await.expect("clear songs");
            assert_eq!(song_count(&pool).await, 0);
            close_test_pool(pool, root).await;
        });
    }
}

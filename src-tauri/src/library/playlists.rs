use super::query::{LibraryError, MAX_PAGE_SIZE};
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::{HashMap, HashSet};
use std::fmt::Write;
use unicode_normalization::UnicodeNormalization;

const ID_RANDOM_BYTES: usize = 16;
const MAX_BATCH_SIZE: usize = 500;
const MAX_NAME_CHARACTERS: usize = 200;
const MAX_OFFSET: u32 = 100_000;
const MAX_SONG_ID_BYTES: usize = 128;
const MAX_SNAPSHOT_CHARACTERS: usize = 1024;
const PLAYLIST_ID_PREFIX: &str = "playlist_";
const ENTRY_ID_PREFIX: &str = "entry_";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlaylistQuery {
    pub limit: u32,
    pub offset: u32,
}

impl Default for PlaylistQuery {
    fn default() -> Self {
        Self {
            limit: 50,
            offset: 0,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlaylistEntryQuery {
    pub limit: u32,
    pub offset: u32,
}

impl Default for PlaylistEntryQuery {
    fn default() -> Self {
        Self {
            limit: 100,
            offset: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub created_at: String,
    pub entry_count: i64,
    pub id: String,
    pub kind: String,
    pub name: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub added_at: String,
    pub album: String,
    pub artist: String,
    pub availability: String,
    pub id: String,
    pub playlist_id: String,
    pub position: i64,
    pub song_id: String,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistPage {
    pub items: Vec<PlaylistSummary>,
    pub total: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntryPage {
    pub items: Vec<PlaylistEntry>,
    pub total: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistMutation {
    pub affected: u32,
}

fn normalize_page(limit: u32, offset: u32) -> Result<(u32, u32), LibraryError> {
    if limit == 0 {
        return Err(LibraryError::invalid_query(
            "Playlist page size must be at least one.",
        ));
    }
    if offset > MAX_OFFSET {
        return Err(LibraryError::invalid_query(
            "Playlist page offset is too large.",
        ));
    }
    Ok((limit.min(MAX_PAGE_SIZE), offset))
}

struct NormalizedName {
    display: String,
    key: String,
}

fn normalize_name(name: &str) -> Result<NormalizedName, LibraryError> {
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > MAX_NAME_CHARACTERS
        || name.chars().any(char::is_control)
    {
        return Err(LibraryError::invalid_query(
            "Playlist names must be present, bounded, and contain no control characters.",
        ));
    }
    let key = name.nfkc().flat_map(char::to_lowercase).collect::<String>();
    if key.chars().count() > MAX_NAME_CHARACTERS * 2 {
        return Err(LibraryError::invalid_query(
            "Playlist names must be present, bounded, and contain no control characters.",
        ));
    }
    Ok(NormalizedName {
        display: name.to_owned(),
        key,
    })
}

fn bounded_snapshot(value: String) -> String {
    value.chars().take(MAX_SNAPSHOT_CHARACTERS).collect()
}

fn generated_id(prefix: &str) -> Result<String, LibraryError> {
    let mut bytes = [0_u8; ID_RANDOM_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| LibraryError::database())?;
    let mut id = String::with_capacity(prefix.len() + ID_RANDOM_BYTES * 2);
    id.push_str(prefix);
    for byte in bytes {
        write!(&mut id, "{byte:02x}").map_err(|_| LibraryError::database())?;
    }
    Ok(id)
}

fn valid_generated_id(id: &str, prefix: &str) -> bool {
    id.len() == prefix.len() + ID_RANDOM_BYTES * 2
        && id.starts_with(prefix)
        && id[prefix.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
}

fn validate_playlist_id(id: &str) -> Result<(), LibraryError> {
    if valid_generated_id(id, PLAYLIST_ID_PREFIX) {
        Ok(())
    } else {
        Err(LibraryError::invalid_query(
            "Playlist identifiers must be opaque and bounded.",
        ))
    }
}

fn validate_song_ids(song_ids: &[String]) -> Result<(), LibraryError> {
    if song_ids.is_empty()
        || song_ids.len() > MAX_BATCH_SIZE
        || song_ids.iter().any(|id| {
            id.is_empty()
                || id.len() > MAX_SONG_ID_BYTES
                || !id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
    {
        return Err(LibraryError::invalid_query(
            "Playlist track batches must contain bounded opaque identifiers.",
        ));
    }
    Ok(())
}

fn validate_entry_ids(entry_ids: &[String]) -> Result<(), LibraryError> {
    if entry_ids.is_empty()
        || entry_ids.len() > MAX_BATCH_SIZE
        || entry_ids
            .iter()
            .any(|id| !valid_generated_id(id, ENTRY_ID_PREFIX))
    {
        return Err(LibraryError::invalid_query(
            "Playlist entry batches must contain bounded opaque identifiers.",
        ));
    }
    Ok(())
}

fn playlist_conflict(error: sqlx::Error) -> LibraryError {
    if error.as_database_error().is_some_and(|database| {
        database.is_unique_violation()
            && (database.message().contains("playlists.name_key")
                || database
                    .constraint()
                    .is_some_and(|constraint| constraint.contains("name_key")))
    }) {
        LibraryError::playlist_name_conflict()
    } else {
        LibraryError::database()
    }
}

fn summary_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<PlaylistSummary, LibraryError> {
    Ok(PlaylistSummary {
        created_at: row
            .try_get("created_at")
            .map_err(|_| LibraryError::database())?,
        entry_count: row
            .try_get("entry_count")
            .map_err(|_| LibraryError::database())?,
        id: row.try_get("id").map_err(|_| LibraryError::database())?,
        kind: row.try_get("kind").map_err(|_| LibraryError::database())?,
        name: row.try_get("name").map_err(|_| LibraryError::database())?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|_| LibraryError::database())?,
    })
}

fn entry_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<PlaylistEntry, LibraryError> {
    Ok(PlaylistEntry {
        added_at: row
            .try_get("added_at")
            .map_err(|_| LibraryError::database())?,
        album: row.try_get("album").map_err(|_| LibraryError::database())?,
        artist: row
            .try_get("artist")
            .map_err(|_| LibraryError::database())?,
        availability: row
            .try_get("availability")
            .map_err(|_| LibraryError::database())?,
        id: row.try_get("id").map_err(|_| LibraryError::database())?,
        playlist_id: row
            .try_get("playlist_id")
            .map_err(|_| LibraryError::database())?,
        position: row
            .try_get("position")
            .map_err(|_| LibraryError::database())?,
        song_id: row
            .try_get("song_id")
            .map_err(|_| LibraryError::database())?,
        title: row.try_get("title").map_err(|_| LibraryError::database())?,
    })
}

async fn summary_by_id(
    executor: impl sqlx::Executor<'_, Database = Sqlite>,
    playlist_id: &str,
) -> Result<PlaylistSummary, LibraryError> {
    let row = sqlx::query(
        "SELECT playlists.id, playlists.name, playlists.kind, playlists.created_at,
                playlists.updated_at, COUNT(playlist_entries.id) AS entry_count
         FROM playlists
         LEFT JOIN playlist_entries ON playlist_entries.playlist_id = playlists.id
         WHERE playlists.id = ?
         GROUP BY playlists.id",
    )
    .bind(playlist_id)
    .fetch_optional(executor)
    .await
    .map_err(|_| LibraryError::database())?
    .ok_or_else(LibraryError::playlist_not_found)?;
    summary_from_row(&row)
}

pub(crate) async fn create_playlist(
    pool: &SqlitePool,
    name: String,
) -> Result<PlaylistSummary, LibraryError> {
    let name = normalize_name(&name)?;
    let id = generated_id(PLAYLIST_ID_PREFIX)?;
    sqlx::query("INSERT INTO playlists (id, name, name_key, kind) VALUES (?, ?, ?, 'manual')")
        .bind(&id)
        .bind(name.display)
        .bind(name.key)
        .execute(pool)
        .await
        .map_err(playlist_conflict)?;
    summary_by_id(pool, &id).await
}

pub(crate) async fn list_playlists(
    pool: &SqlitePool,
    query: PlaylistQuery,
) -> Result<PlaylistPage, LibraryError> {
    let (limit, offset) = normalize_page(query.limit, query.offset)?;
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    let total = sqlx::query_scalar("SELECT COUNT(*) FROM playlists")
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    let rows = sqlx::query(
        "SELECT playlists.id, playlists.name, playlists.kind, playlists.created_at,
                playlists.updated_at, COUNT(playlist_entries.id) AS entry_count
         FROM playlists
         LEFT JOIN playlist_entries ON playlist_entries.playlist_id = playlists.id
         GROUP BY playlists.id
         ORDER BY playlists.updated_at DESC, playlists.name COLLATE NOCASE,
                  playlists.name COLLATE BINARY, playlists.id
         LIMIT ? OFFSET ?",
    )
    .bind(i64::from(limit))
    .bind(i64::from(offset))
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?;
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    Ok(PlaylistPage {
        items: rows
            .iter()
            .map(summary_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        total,
    })
}

pub(crate) async fn rename_playlist(
    pool: &SqlitePool,
    playlist_id: String,
    name: String,
) -> Result<PlaylistSummary, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    let name = normalize_name(&name)?;
    let result = sqlx::query(
        "UPDATE playlists
         SET name = ?, name_key = ?, updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND kind = 'manual'",
    )
    .bind(name.display)
    .bind(name.key)
    .bind(&playlist_id)
    .execute(pool)
    .await
    .map_err(playlist_conflict)?;
    if result.rows_affected() != 1 {
        return Err(LibraryError::playlist_not_found());
    }
    summary_by_id(pool, &playlist_id).await
}

pub(crate) async fn delete_playlist(
    pool: &SqlitePool,
    playlist_id: String,
) -> Result<PlaylistMutation, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    let result = sqlx::query("DELETE FROM playlists WHERE id = ? AND kind = 'manual'")
        .bind(playlist_id)
        .execute(pool)
        .await
        .map_err(|_| LibraryError::database())?;
    if result.rows_affected() != 1 {
        return Err(LibraryError::playlist_not_found());
    }
    Ok(PlaylistMutation { affected: 1 })
}

async fn ensure_playlist(
    executor: impl sqlx::Executor<'_, Database = Sqlite>,
    playlist_id: &str,
) -> Result<(), LibraryError> {
    let exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM playlists WHERE id = ? AND kind = 'manual'")
            .bind(playlist_id)
            .fetch_one(executor)
            .await
            .map_err(|_| LibraryError::database())?;
    if exists == 1 {
        Ok(())
    } else {
        Err(LibraryError::playlist_not_found())
    }
}

pub(crate) async fn add_playlist_entries(
    pool: &SqlitePool,
    playlist_id: String,
    song_ids: Vec<String>,
) -> Result<PlaylistMutation, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    validate_song_ids(&song_ids)?;
    let entry_ids = (0..song_ids.len())
        .map(|_| generated_id(ENTRY_ID_PREFIX))
        .collect::<Result<Vec<_>, _>>()?;
    let unique_song_ids = song_ids.iter().cloned().collect::<HashSet<_>>();
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    ensure_playlist(&mut *transaction, &playlist_id).await?;

    let mut snapshots = HashMap::with_capacity(unique_song_ids.len());
    for chunk in unique_song_ids
        .iter()
        .collect::<Vec<_>>()
        .chunks(MAX_BATCH_SIZE)
    {
        let mut query =
            QueryBuilder::<Sqlite>::new("SELECT id, title, artist, album FROM songs WHERE id IN (");
        let mut separated = query.separated(", ");
        for song_id in chunk {
            separated.push_bind((*song_id).clone());
        }
        separated.push_unseparated(")");
        for row in query
            .build()
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?
        {
            let song_id: String = row.try_get("id").map_err(|_| LibraryError::database())?;
            snapshots.insert(
                song_id,
                (
                    bounded_snapshot(
                        row.try_get::<String, _>("title")
                            .map_err(|_| LibraryError::database())?,
                    ),
                    bounded_snapshot(
                        row.try_get::<String, _>("artist")
                            .map_err(|_| LibraryError::database())?,
                    ),
                    bounded_snapshot(
                        row.try_get::<String, _>("album")
                            .map_err(|_| LibraryError::database())?,
                    ),
                ),
            );
        }
    }
    if snapshots.len() != unique_song_ids.len() {
        return Err(LibraryError::invalid_query(
            "Every playlist track must exist in the catalog when it is added.",
        ));
    }

    let start: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_entries WHERE playlist_id = ?",
    )
    .bind(&playlist_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?;
    for (index, (entry_id, song_id)) in entry_ids.iter().zip(&song_ids).enumerate() {
        let (title, artist, album) = snapshots.get(song_id).ok_or_else(LibraryError::database)?;
        sqlx::query(
            "INSERT INTO playlist_entries (
                id, playlist_id, song_id, position, title_snapshot, artist_snapshot,
                album_snapshot
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(entry_id)
        .bind(&playlist_id)
        .bind(song_id)
        .bind(start + index as i64)
        .bind(title)
        .bind(artist)
        .bind(album)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    }
    sqlx::query(
        "UPDATE playlists SET updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(&playlist_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?;
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    Ok(PlaylistMutation {
        affected: song_ids.len() as u32,
    })
}

pub(crate) async fn list_playlist_entries(
    pool: &SqlitePool,
    playlist_id: String,
    query: PlaylistEntryQuery,
) -> Result<PlaylistEntryPage, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    let (limit, offset) = normalize_page(query.limit, query.offset)?;
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    ensure_playlist(&mut *transaction, &playlist_id).await?;
    let total = sqlx::query_scalar("SELECT COUNT(*) FROM playlist_entries WHERE playlist_id = ?")
        .bind(&playlist_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    let rows = sqlx::query(
        "SELECT entries.id, entries.playlist_id, entries.song_id, entries.position,
                entries.added_at,
                COALESCE(songs.title, entries.title_snapshot) AS title,
                COALESCE(songs.artist, entries.artist_snapshot) AS artist,
                COALESCE(songs.album, entries.album_snapshot) AS album,
                CASE WHEN songs.id IS NULL THEN 'missing' ELSE songs.availability END AS availability
         FROM playlist_entries AS entries
         LEFT JOIN songs ON songs.id = entries.song_id
         WHERE entries.playlist_id = ?
         ORDER BY entries.position, entries.id
         LIMIT ? OFFSET ?",
    )
    .bind(&playlist_id)
    .bind(i64::from(limit))
    .bind(i64::from(offset))
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?;
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    Ok(PlaylistEntryPage {
        items: rows
            .iter()
            .map(entry_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        total,
    })
}

pub(crate) async fn remove_playlist_entries(
    pool: &SqlitePool,
    playlist_id: String,
    entry_ids: Vec<String>,
) -> Result<PlaylistMutation, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    validate_entry_ids(&entry_ids)?;
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    ensure_playlist(&mut *transaction, &playlist_id).await?;
    let mut query =
        QueryBuilder::<Sqlite>::new("DELETE FROM playlist_entries WHERE playlist_id = ");
    query.push_bind(&playlist_id).push(" AND id IN (");
    let mut separated = query.separated(", ");
    for entry_id in &entry_ids {
        separated.push_bind(entry_id);
    }
    separated.push_unseparated(")");
    let affected = query
        .build()
        .execute(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?
        .rows_affected() as u32;
    if affected > 0 {
        sqlx::query(
            "UPDATE playlists SET updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?",
        )
        .bind(&playlist_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    }
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    Ok(PlaylistMutation { affected })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn fixture() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open playlist fixture");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate playlist fixture");
        for id in ["one", "two"] {
            sqlx::query(
                "INSERT INTO songs (
                    id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
                    trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
                    favorRating, dateAdded, visualsPath
                 ) VALUES (?, ?, ?, ?, 'Album', 'Artist', '', 0, 0, '2026', '', 2, 1,
                           'flac', '0:03:00.000', '44100', 1, 0, 0, '2026-08-27', '')",
            )
            .bind(id)
            .bind(format!("/music/{id}.flac"))
            .bind(format!("{id}.flac"))
            .bind(format!("Track {id}"))
            .execute(&pool)
            .await
            .expect("insert playlist fixture song");
        }
        pool
    }

    #[test]
    fn names_are_normalized_unique_and_mutable_with_bounded_pages() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let created = create_playlist(&pool, "  Favorites for later  ".to_owned())
                .await
                .expect("create playlist");
            assert_eq!(created.name, "Favorites for later");
            assert_eq!(created.entry_count, 0);
            assert!(valid_generated_id(&created.id, PLAYLIST_ID_PREFIX));

            let conflict = create_playlist(&pool, "favorites FOR later".to_owned())
                .await
                .expect_err("reject duplicate name");
            assert_eq!(conflict.code, "playlist_name_conflict");
            let unicode = create_playlist(&pool, "Été".to_owned())
                .await
                .expect("create Unicode playlist");
            assert_eq!(
                create_playlist(&pool, "ÉTÉ".to_owned())
                    .await
                    .expect_err("reject Unicode case duplicate")
                    .code,
                "playlist_name_conflict"
            );
            let canonical = create_playlist(&pool, "Café".to_owned())
                .await
                .expect("create composed Unicode playlist");
            assert_eq!(
                create_playlist(&pool, "Cafe\u{301}".to_owned())
                    .await
                    .expect_err("reject canonically equivalent Unicode name")
                    .code,
                "playlist_name_conflict"
            );
            for name in [String::new(), "bad\nname".to_owned(), "x".repeat(201)] {
                assert_eq!(
                    create_playlist(&pool, name)
                        .await
                        .expect_err("reject invalid name")
                        .code,
                    "invalid_query"
                );
            }

            let renamed = rename_playlist(&pool, created.id.clone(), "Road trip".to_owned())
                .await
                .expect("rename playlist");
            assert_eq!(renamed.name, "Road trip");
            let page = list_playlists(&pool, PlaylistQuery::default())
                .await
                .expect("list playlists");
            assert_eq!(page.total, 3);
            assert!(page.items.iter().any(|item| item.id == created.id));

            assert_eq!(
                delete_playlist(&pool, created.id.clone())
                    .await
                    .expect("delete playlist")
                    .affected,
                1
            );
            assert_eq!(
                delete_playlist(&pool, created.id)
                    .await
                    .expect_err("reject missing playlist")
                    .code,
                "playlist_not_found"
            );
            delete_playlist(&pool, unicode.id)
                .await
                .expect("delete Unicode playlist");
            delete_playlist(&pool, canonical.id)
                .await
                .expect("delete canonical playlist");
        });
    }

    #[test]
    fn duplicate_entries_are_stable_and_survive_catalog_deletion_with_snapshots() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let playlist = create_playlist(&pool, "Duplicates".to_owned())
                .await
                .expect("create duplicate playlist");
            sqlx::query("UPDATE songs SET title = ? WHERE id = 'two'")
                .bind("x".repeat(MAX_SNAPSHOT_CHARACTERS + 100))
                .execute(&pool)
                .await
                .expect("add oversized snapshot fixture");
            let added = add_playlist_entries(
                &pool,
                playlist.id.clone(),
                vec!["one".to_owned(), "one".to_owned(), "two".to_owned()],
            )
            .await
            .expect("add duplicate playlist entries");
            assert_eq!(added.affected, 3);

            let first_page = list_playlist_entries(
                &pool,
                playlist.id.clone(),
                PlaylistEntryQuery {
                    limit: 2,
                    offset: 0,
                },
            )
            .await
            .expect("page playlist entries");
            assert_eq!(first_page.total, 3);
            assert_eq!(first_page.items.len(), 2);
            assert_eq!(first_page.items[0].song_id, "one");
            assert_eq!(first_page.items[1].song_id, "one");
            assert_ne!(first_page.items[0].id, first_page.items[1].id);
            assert_eq!(first_page.items[0].position, 0);
            assert_eq!(first_page.items[1].position, 1);
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT LENGTH(title_snapshot) FROM playlist_entries
                     WHERE playlist_id = ? AND song_id = 'two'"
                )
                .bind(&playlist.id)
                .fetch_one(&pool)
                .await
                .expect("read bounded snapshot"),
                MAX_SNAPSHOT_CHARACTERS as i64
            );

            sqlx::query("DELETE FROM songs WHERE id = 'one'")
                .execute(&pool)
                .await
                .expect("delete catalog song");
            let orphaned =
                list_playlist_entries(&pool, playlist.id.clone(), PlaylistEntryQuery::default())
                    .await
                    .expect("read orphaned playlist entries");
            assert_eq!(orphaned.items[0].availability, "missing");
            assert_eq!(orphaned.items[0].title, "Track one");

            let removed =
                remove_playlist_entries(&pool, playlist.id, vec![orphaned.items[0].id.clone()])
                    .await
                    .expect("remove one duplicate entry");
            assert_eq!(removed.affected, 1);
        });
    }

    #[test]
    fn invalid_batch_rolls_back_without_partial_entries() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let playlist = create_playlist(&pool, "Atomic".to_owned())
                .await
                .expect("create atomic playlist");
            assert_eq!(
                add_playlist_entries(
                    &pool,
                    playlist.id.clone(),
                    vec!["one".to_owned(), "missing".to_owned()],
                )
                .await
                .expect_err("reject missing batch member")
                .code,
                "invalid_query"
            );
            let page = list_playlist_entries(&pool, playlist.id, PlaylistEntryQuery::default())
                .await
                .expect("read atomic playlist");
            assert_eq!(page.total, 0);
            assert!(page.items.is_empty());
        });
    }
}

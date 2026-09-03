use super::query::{LibraryError, SortDirection, MAX_PAGE_SIZE};
use super::repository::{fts_expression, push_exact_filter, push_search};
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AggregateQuery {
    pub artist: Option<String>,
    pub direction: SortDirection,
    pub limit: u32,
    pub offset: u32,
    pub q: String,
}

impl Default for AggregateQuery {
    fn default() -> Self {
        Self {
            artist: None,
            direction: SortDirection::Asc,
            limit: 50,
            offset: 0,
            q: String::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistSummary {
    pub album_count: i64,
    pub name: String,
    pub track_count: i64,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumSummary {
    pub artist: String,
    pub artist_value: String,
    pub date: String,
    pub is_compilation: bool,
    pub name: String,
    pub track_count: i64,
    pub value: String,
    pub visuals_path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistPage {
    pub items: Vec<ArtistSummary>,
    pub revision: i64,
    pub total: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumPage {
    pub items: Vec<AlbumSummary>,
    pub revision: i64,
    pub total: i64,
}

#[derive(Debug)]
struct NormalizedAggregateQuery {
    artist: Option<String>,
    direction: SortDirection,
    limit: u32,
    offset: u32,
    q: String,
}

impl AggregateQuery {
    fn normalize(self) -> Result<NormalizedAggregateQuery, LibraryError> {
        if self.limit == 0 {
            return Err(LibraryError::invalid_query(
                "Aggregate page size must be at least one.",
            ));
        }
        let q = self.q.trim().to_owned();
        if q.chars().count() > 256 {
            return Err(LibraryError::invalid_query("Aggregate search is too long."));
        }
        if self
            .artist
            .as_deref()
            .is_some_and(|artist| artist.chars().count() > 1_024)
        {
            return Err(LibraryError::invalid_query(
                "Aggregate artist filter is too long.",
            ));
        }
        Ok(NormalizedAggregateQuery {
            artist: self.artist,
            direction: self.direction,
            limit: self.limit.min(MAX_PAGE_SIZE),
            offset: self.offset,
            q,
        })
    }
}

pub(crate) async fn load_artist_page(
    pool: &SqlitePool,
    query: AggregateQuery,
) -> Result<ArtistPage, LibraryError> {
    let query = query.normalize()?;
    let search = fts_expression(&query.q);
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    let revision = read_revision(&mut transaction).await?;

    let mut count = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM (SELECT artist FROM songs");
    let has_filter = push_search(&mut count, search.as_deref(), false);
    push_exact_filter(&mut count, "artist", query.artist.as_deref(), has_filter);
    count.push(" GROUP BY artist)");
    let total = count
        .build_query_scalar::<i64>()
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;

    let mut page = QueryBuilder::<Sqlite>::new(
        "SELECT COALESCE(NULLIF(TRIM(artist), ''), '-') AS name, artist AS value,
                COUNT(DISTINCT album) AS album_count, COUNT(*) AS track_count
         FROM songs",
    );
    let has_filter = push_search(&mut page, search.as_deref(), false);
    push_exact_filter(&mut page, "artist", query.artist.as_deref(), has_filter);
    page.push(" GROUP BY artist ORDER BY name COLLATE NOCASE");
    push_direction(&mut page, query.direction);
    page.push(", name COLLATE BINARY");
    push_direction(&mut page, query.direction);
    page.push(" LIMIT ").push_bind(i64::from(query.limit));
    page.push(" OFFSET ").push_bind(i64::from(query.offset));
    let rows = page
        .build()
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    let items = rows
        .into_iter()
        .map(|row| {
            Ok(ArtistSummary {
                album_count: row
                    .try_get("album_count")
                    .map_err(|_| LibraryError::database())?,
                name: row.try_get("name").map_err(|_| LibraryError::database())?,
                track_count: row
                    .try_get("track_count")
                    .map_err(|_| LibraryError::database())?,
                value: row.try_get("value").map_err(|_| LibraryError::database())?,
            })
        })
        .collect::<Result<Vec<_>, LibraryError>>()?;
    Ok(ArtistPage {
        items,
        revision,
        total,
    })
}

pub(crate) async fn load_album_page(
    pool: &SqlitePool,
    query: AggregateQuery,
) -> Result<AlbumPage, LibraryError> {
    let query = query.normalize()?;
    let search = fts_expression(&query.q);
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    let revision = read_revision(&mut transaction).await?;

    let mut count = QueryBuilder::<Sqlite>::new(
        "SELECT COUNT(*) FROM (
         SELECT CASE WHEN compilation <> 0 THEN '' ELSE artist END AS album_artist,
                CASE WHEN compilation <> 0 THEN 1 ELSE 0 END AS is_compilation,
                album
         FROM songs",
    );
    let has_filter = push_search(&mut count, search.as_deref(), false);
    push_album_artist_filter(&mut count, query.artist.as_deref(), has_filter);
    count.push(" GROUP BY album_artist, is_compilation, album)");
    let total = count
        .build_query_scalar::<i64>()
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;

    let mut page = QueryBuilder::<Sqlite>::new(
        "SELECT CASE WHEN compilation <> 0
                     THEN 'Various Artists'
                     ELSE COALESCE(NULLIF(TRIM(artist), ''), '-')
                END AS artist,
                CASE WHEN compilation <> 0 THEN '' ELSE artist END AS artist_value,
                COALESCE(NULLIF(TRIM(album), ''), '-') AS name, album AS value,
                MAX(date) AS date, compilation <> 0 AS is_compilation, COUNT(*) AS track_count,
                COALESCE(MIN(NULLIF(visualsPath, '')), '') AS visuals_path
         FROM songs",
    );
    let has_filter = push_search(&mut page, search.as_deref(), false);
    push_album_artist_filter(&mut page, query.artist.as_deref(), has_filter);
    page.push(" GROUP BY artist_value, is_compilation, album ORDER BY artist COLLATE NOCASE");
    push_direction(&mut page, query.direction);
    page.push(", name COLLATE NOCASE");
    push_direction(&mut page, query.direction);
    page.push(", artist COLLATE BINARY");
    push_direction(&mut page, query.direction);
    page.push(", name COLLATE BINARY");
    push_direction(&mut page, query.direction);
    page.push(" LIMIT ").push_bind(i64::from(query.limit));
    page.push(" OFFSET ").push_bind(i64::from(query.offset));
    let rows = page
        .build()
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    let items = rows
        .into_iter()
        .map(|row| {
            Ok(AlbumSummary {
                artist: row
                    .try_get("artist")
                    .map_err(|_| LibraryError::database())?,
                artist_value: row
                    .try_get("artist_value")
                    .map_err(|_| LibraryError::database())?,
                date: row.try_get("date").map_err(|_| LibraryError::database())?,
                is_compilation: row
                    .try_get::<i64, _>("is_compilation")
                    .map_err(|_| LibraryError::database())?
                    != 0,
                name: row.try_get("name").map_err(|_| LibraryError::database())?,
                track_count: row
                    .try_get("track_count")
                    .map_err(|_| LibraryError::database())?,
                value: row.try_get("value").map_err(|_| LibraryError::database())?,
                visuals_path: row
                    .try_get("visuals_path")
                    .map_err(|_| LibraryError::database())?,
            })
        })
        .collect::<Result<Vec<_>, LibraryError>>()?;
    Ok(AlbumPage {
        items,
        revision,
        total,
    })
}

async fn read_revision(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
) -> Result<i64, LibraryError> {
    sqlx::query_scalar("SELECT revision FROM catalog_meta WHERE id = 1")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|_| LibraryError::database())
}

fn push_direction(builder: &mut QueryBuilder<'_, Sqlite>, direction: SortDirection) {
    builder.push(match direction {
        SortDirection::Asc => " ASC",
        SortDirection::Desc => " DESC",
    });
}

fn push_album_artist_filter(
    builder: &mut QueryBuilder<'_, Sqlite>,
    artist: Option<&str>,
    has_where: bool,
) -> bool {
    let Some(artist) = artist else {
        return has_where;
    };

    builder
        .push(if has_where { " AND " } else { " WHERE " })
        .push("((compilation = 0 AND artist = ")
        .push_bind(artist.to_owned())
        .push(
            ") OR (compilation <> 0 AND album IN (
            SELECT related.album FROM songs AS related
            WHERE related.compilation <> 0 AND related.artist = ",
        )
        .push_bind(artist.to_owned())
        .push(")))");
    true
}

#[tauri::command]
pub async fn query_artists(
    library: tauri::State<'_, super::LibraryState>,
    query: AggregateQuery,
) -> Result<ArtistPage, LibraryError> {
    library.query_artists(query).await
}

#[tauri::command]
pub async fn query_albums(
    library: tauri::State<'_, super::LibraryState>,
    query: AggregateQuery,
) -> Result<AlbumPage, LibraryError> {
    library.query_albums(query).await
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
            .expect("open aggregate fixture");
        sqlx::raw_sql(crate::database::INITIAL_SCHEMA)
            .execute(&pool)
            .await
            .expect("apply initial schema");
        sqlx::raw_sql(crate::database::CATALOG_QUERY_SCHEMA)
            .execute(&pool)
            .await
            .expect("apply catalog query schema");
        for (id, title, album, artist, date, art) in [
            ("1", "Needle One", "First", "Björk", "2020", "art-a"),
            ("2", "Second", "First", "Björk", "2021", ""),
            ("3", "Needle Two", "Second", "Björk", "2019", "art-b"),
            ("4", "Fourth", "Third", "Other", "2022", "art-c"),
            ("5", "Untitled", "", "", "", ""),
        ] {
            insert_song(&pool, id, title, album, artist, date, art).await;
        }
        pool
    }

    async fn insert_song(
        pool: &SqlitePool,
        id: &str,
        title: &str,
        album: &str,
        artist: &str,
        date: &str,
        art: &str,
    ) {
        insert_song_with_compilation(pool, id, title, album, artist, date, art, 0).await;
    }

    #[allow(clippy::too_many_arguments)]
    async fn insert_song_with_compilation(
        pool: &SqlitePool,
        id: &str,
        title: &str,
        album: &str,
        artist: &str,
        date: &str,
        art: &str,
        compilation: i64,
    ) {
        sqlx::query(
            "INSERT INTO songs (
               id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
               trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
               favorRating, dateAdded, visualsPath
             ) VALUES (?, ?, ?, ?, ?, ?, '', 0, ?, ?, '', 0, 0, 'flac', '', '44100',
                       0, 0, 0, '2026-08-26', ?)",
        )
        .bind(id)
        .bind(format!("track-{id}.flac"))
        .bind(format!("track-{id}.flac"))
        .bind(title)
        .bind(album)
        .bind(artist)
        .bind(compilation)
        .bind(date)
        .bind(art)
        .execute(pool)
        .await
        .expect("insert aggregate song");
    }

    #[test]
    fn aggregate_query_normalizes_bounds_and_search() {
        let normalized = AggregateQuery {
            limit: 1_000,
            q: "  Needle  ".to_owned(),
            ..AggregateQuery::default()
        }
        .normalize()
        .expect("normalize aggregate query");
        assert_eq!(normalized.limit, MAX_PAGE_SIZE);
        assert_eq!(normalized.q, "Needle");
        assert_eq!(
            AggregateQuery {
                limit: 0,
                ..AggregateQuery::default()
            }
            .normalize()
            .expect_err("reject empty aggregate page")
            .code,
            "invalid_query"
        );
    }

    #[test]
    fn artist_pages_are_bounded_searchable_and_revision_aware() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let first = load_artist_page(
                &pool,
                AggregateQuery {
                    limit: 2,
                    ..AggregateQuery::default()
                },
            )
            .await
            .expect("query first artist page");
            assert_eq!(first.total, 3);
            assert_eq!(first.items.len(), 2);
            assert_eq!(first.items[0].name, "-");
            assert_eq!(first.items[0].value, "");
            assert_eq!(first.revision, 5);

            let searched = load_artist_page(
                &pool,
                AggregateQuery {
                    q: "Needle".to_owned(),
                    ..AggregateQuery::default()
                },
            )
            .await
            .expect("search artists");
            assert_eq!(searched.total, 1);
            assert_eq!(searched.items[0].name, "Björk");
            assert_eq!(searched.items[0].album_count, 2);
            assert_eq!(searched.items[0].track_count, 2);
        });
    }

    #[test]
    fn album_pages_group_deterministically_with_art_and_counts() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let page = load_album_page(
                &pool,
                AggregateQuery {
                    direction: SortDirection::Desc,
                    limit: 2,
                    offset: 1,
                    ..AggregateQuery::default()
                },
            )
            .await
            .expect("query album page");
            assert_eq!(page.total, 4);
            assert_eq!(page.items.len(), 2);
            assert_eq!(page.items[0].artist, "Björk");
            assert_eq!(page.items[0].artist_value, "Björk");
            assert_eq!(page.items[0].name, "Second");
            assert_eq!(page.items[0].value, "Second");
            assert_eq!(page.items[0].track_count, 1);

            let first_album = load_album_page(
                &pool,
                AggregateQuery {
                    q: "First".to_owned(),
                    ..AggregateQuery::default()
                },
            )
            .await
            .expect("search albums");
            assert_eq!(first_album.total, 1);
            assert_eq!(first_album.items[0].date, "2021");
            assert_eq!(first_album.items[0].track_count, 2);
            assert!(!first_album.items[0].is_compilation);
            assert_eq!(first_album.items[0].visuals_path, "art-a");

            let artist_albums = load_album_page(
                &pool,
                AggregateQuery {
                    artist: Some("Björk".to_owned()),
                    ..AggregateQuery::default()
                },
            )
            .await
            .expect("filter albums by exact artist");
            assert_eq!(artist_albums.total, 2);
            assert!(artist_albums
                .items
                .iter()
                .all(|album| album.artist_value == "Björk"));
        });
    }

    #[test]
    fn compilation_albums_group_across_track_artists() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            insert_song_with_compilation(
                &pool,
                "6",
                "Featured One",
                "One Complete Album",
                "Primary Artist feat. Guest",
                "2024",
                "art-compilation",
                1,
            )
            .await;
            insert_song_with_compilation(
                &pool,
                "7",
                "Featured Two",
                "One Complete Album",
                "Another Guest",
                "2024",
                "",
                1,
            )
            .await;

            let page = load_album_page(
                &pool,
                AggregateQuery {
                    q: "One Complete Album".to_owned(),
                    ..AggregateQuery::default()
                },
            )
            .await
            .expect("query compilation album");

            assert_eq!(page.total, 1);
            assert_eq!(page.items.len(), 1);
            assert_eq!(page.items[0].artist, "Various Artists");
            assert_eq!(page.items[0].artist_value, "");
            assert_eq!(page.items[0].track_count, 2);
            assert!(page.items[0].is_compilation);
            assert_eq!(page.items[0].visuals_path, "art-compilation");

            let artist_page = load_album_page(
                &pool,
                AggregateQuery {
                    artist: Some("Primary Artist feat. Guest".to_owned()),
                    ..AggregateQuery::default()
                },
            )
            .await
            .expect("query compilation from an artist");

            assert_eq!(artist_page.total, 1);
            assert_eq!(artist_page.items.len(), 1);
            assert_eq!(artist_page.items[0].name, "One Complete Album");
            assert_eq!(artist_page.items[0].track_count, 2);
            assert!(artist_page.items[0].is_compilation);
        });
    }
}

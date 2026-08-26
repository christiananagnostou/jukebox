use super::query::{
    decode_cursor, encode_cursor, CursorValue, LibraryError, SortDirection, TrackQuery, TrackSort,
};
use serde::Serialize;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSummary {
    pub album: String,
    pub artist: String,
    pub codec: String,
    pub date: String,
    pub date_added: String,
    pub duration: String,
    pub favor_rating: i64,
    pub file: String,
    pub id: String,
    pub path: String,
    pub sample_rate: String,
    pub side: i64,
    pub start_time: i64,
    pub title: String,
    pub track_number: i64,
    pub visuals_path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackPage {
    pub items: Vec<TrackSummary>,
    pub next_cursor: Option<String>,
    pub revision: i64,
    pub total: i64,
}

#[derive(Clone, Copy)]
struct SortTerm {
    expression: &'static str,
}

const DEFAULT_SORT: &[SortTerm] = &[
    SortTerm {
        expression: "artist COLLATE NOCASE",
    },
    SortTerm {
        expression: "album COLLATE NOCASE",
    },
    SortTerm { expression: "side" },
    SortTerm {
        expression: "trackNumber",
    },
    SortTerm {
        expression: "title COLLATE NOCASE",
    },
];
const ALBUM_SORT: &[SortTerm] = &[
    SortTerm {
        expression: "album COLLATE NOCASE",
    },
    SortTerm {
        expression: "artist COLLATE NOCASE",
    },
    SortTerm {
        expression: "trackNumber",
    },
];
const ARTIST_SORT: &[SortTerm] = &[
    SortTerm {
        expression: "artist COLLATE NOCASE",
    },
    SortTerm {
        expression: "album COLLATE NOCASE",
    },
    SortTerm {
        expression: "trackNumber",
    },
];
const TRACK_SORT: &[SortTerm] = &[
    SortTerm {
        expression: "trackNumber",
    },
    SortTerm {
        expression: "title COLLATE NOCASE",
    },
];
const TITLE_SORT: &[SortTerm] = &[SortTerm {
    expression: "title COLLATE NOCASE",
}];
const SAMPLE_RATE_SORT: &[SortTerm] = &[SortTerm {
    expression: "CAST(sampleRate AS INTEGER)",
}];
const DATE_SORT: &[SortTerm] = &[SortTerm {
    expression: "CAST(date AS INTEGER)",
}];
const DATE_ADDED_SORT: &[SortTerm] = &[SortTerm {
    expression: "dateAdded",
}];
const FAVORITE_SORT: &[SortTerm] = &[SortTerm {
    expression: "favorRating",
}];

#[derive(Clone)]
pub struct LibraryRepository {
    pool: SqlitePool,
}

impl LibraryRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub(crate) fn pool(&self) -> SqlitePool {
        self.pool.clone()
    }

    pub(crate) async fn initialize_schema(&self) -> Result<(), LibraryError> {
        crate::database::NATIVE_MIGRATOR
            .run(&self.pool)
            .await
            .map_err(|_| LibraryError::database())?;
        Ok(())
    }

    pub async fn query_tracks(&self, query: TrackQuery) -> Result<TrackPage, LibraryError> {
        let query = query.normalize()?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| LibraryError::database())?;
        let revision: i64 = sqlx::query_scalar("SELECT revision FROM catalog_meta WHERE id = 1")
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
        let cursor = match query.cursor.as_deref() {
            Some(cursor) => Some(decode_cursor(cursor, &query, revision)?),
            None => None,
        };
        let search = fts_expression(&query.q);

        let mut count_query = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM songs");
        let mut has_filter = push_search(&mut count_query, search.as_deref(), false);
        has_filter = push_exact_filter(
            &mut count_query,
            "artist",
            query.artist.as_deref(),
            has_filter,
        );
        has_filter = push_exact_filter(
            &mut count_query,
            "album",
            query.album.as_deref(),
            has_filter,
        );
        push_storage_filter(
            &mut count_query,
            query.root_id,
            query.path_prefix.as_deref(),
            has_filter,
        );
        let total: i64 = count_query
            .build_query_scalar()
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;

        let mut page_query = QueryBuilder::<Sqlite>::new(
            "SELECT id, path, file, title, album, artist, date, trackNumber, codec, duration, \
             sampleRate, side, startTime, favorRating, dateAdded, visualsPath FROM songs",
        );
        let mut has_filter = push_search(&mut page_query, search.as_deref(), false);
        has_filter = push_exact_filter(
            &mut page_query,
            "artist",
            query.artist.as_deref(),
            has_filter,
        );
        has_filter =
            push_exact_filter(&mut page_query, "album", query.album.as_deref(), has_filter);
        has_filter = push_storage_filter(
            &mut page_query,
            query.root_id,
            query.path_prefix.as_deref(),
            has_filter,
        );
        let terms = sort_terms(query.sort);
        if let Some((values, last_song_id)) = cursor.as_ref() {
            page_query.push(if has_filter { " AND (" } else { " WHERE (" });
            push_keyset_condition(
                &mut page_query,
                terms,
                values,
                last_song_id,
                query.direction,
            );
            page_query.push(")");
        }
        page_query.push(" ORDER BY ");
        let order = match query.direction {
            SortDirection::Asc => " ASC",
            SortDirection::Desc => " DESC",
        };
        for (index, term) in terms.iter().enumerate() {
            if index > 0 {
                page_query.push(", ");
            }
            page_query.push(term.expression).push(order);
        }
        if !terms.is_empty() {
            page_query.push(", ");
        }
        page_query.push("id COLLATE BINARY").push(order);
        page_query
            .push(" LIMIT ")
            .push_bind(i64::from(query.limit) + 1);

        let rows = page_query
            .build()
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
        transaction
            .commit()
            .await
            .map_err(|_| LibraryError::database())?;

        let mut items = rows
            .iter()
            .map(track_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        let has_next = items.len() > query.limit as usize;
        items.truncate(query.limit as usize);
        let next_cursor = if has_next {
            let last = items.last().ok_or_else(LibraryError::database)?;
            Some(encode_cursor(
                &query,
                revision,
                sort_values(last, query.sort),
                last.id.clone(),
            )?)
        } else {
            None
        };

        Ok(TrackPage {
            items,
            next_cursor,
            revision,
            total,
        })
    }
}

pub(super) fn push_search(
    builder: &mut QueryBuilder<'_, Sqlite>,
    search: Option<&str>,
    has_where: bool,
) -> bool {
    if let Some(search) = search {
        builder
            .push(if has_where { " AND " } else { " WHERE " })
            .push("id IN (SELECT song_id FROM songs_fts WHERE songs_fts MATCH ")
            .push_bind(search.to_owned())
            .push(")");
        true
    } else {
        has_where
    }
}

pub(super) fn fts_expression(query: &str) -> Option<String> {
    let tokens = query
        .split_whitespace()
        .map(|token| token.replace('"', "\"\""))
        .filter(|token| token.chars().any(char::is_alphanumeric))
        .map(|token| format!("\"{token}\""))
        .collect::<Vec<_>>();
    (!tokens.is_empty()).then(|| tokens.join(" AND "))
}

pub(super) fn push_exact_filter(
    builder: &mut QueryBuilder<'_, Sqlite>,
    column: &'static str,
    value: Option<&str>,
    has_where: bool,
) -> bool {
    if let Some(value) = value {
        builder
            .push(if has_where { " AND " } else { " WHERE " })
            .push(column)
            .push(" = ")
            .push_bind(value.to_owned());
        true
    } else {
        has_where
    }
}

fn push_storage_filter(
    builder: &mut QueryBuilder<'_, Sqlite>,
    root_id: Option<i64>,
    path_prefix: Option<&str>,
    has_where: bool,
) -> bool {
    let Some(root_id) = root_id else {
        return has_where;
    };
    builder.push(if has_where { " AND " } else { " WHERE " });
    if root_id == 0 {
        builder.push("root_id IS NULL AND availability = 'available'");
        if let Some(song_id) = path_prefix {
            builder.push(" AND id = ").push_bind(song_id.to_owned());
        }
        return true;
    }
    builder
        .push("root_id = ")
        .push_bind(root_id)
        .push(" AND availability = 'available'");
    if let Some(path_prefix) = path_prefix {
        builder
            .push(" AND (normalized_path = ")
            .push_bind(path_prefix.to_owned())
            .push(" OR (normalized_path >= ")
            .push_bind(format!("{path_prefix}/"))
            .push(" AND normalized_path < ")
            .push_bind(format!("{path_prefix}0"))
            .push("))");
    }
    true
}

fn sort_terms(sort: TrackSort) -> &'static [SortTerm] {
    match sort {
        TrackSort::Default => DEFAULT_SORT,
        TrackSort::Album => ALBUM_SORT,
        TrackSort::Artist => ARTIST_SORT,
        TrackSort::Date => DATE_SORT,
        TrackSort::DateAdded => DATE_ADDED_SORT,
        TrackSort::Favorite => FAVORITE_SORT,
        TrackSort::SampleRate => SAMPLE_RATE_SORT,
        TrackSort::Title => TITLE_SORT,
        TrackSort::Track => TRACK_SORT,
    }
}

fn push_keyset_condition(
    builder: &mut QueryBuilder<'_, Sqlite>,
    terms: &[SortTerm],
    values: &[CursorValue],
    last_song_id: &str,
    direction: SortDirection,
) {
    let comparison = match direction {
        SortDirection::Asc => " > ",
        SortDirection::Desc => " < ",
    };
    for level in 0..=terms.len() {
        if level > 0 {
            builder.push(" OR ");
        }
        builder.push("(");
        for previous in 0..level {
            builder.push(terms[previous].expression).push(" = ");
            push_cursor_bind(builder, &values[previous]);
            builder.push(" AND ");
        }
        if level == terms.len() {
            builder
                .push("id COLLATE BINARY")
                .push(comparison)
                .push_bind(last_song_id.to_owned());
        } else {
            builder.push(terms[level].expression).push(comparison);
            push_cursor_bind(builder, &values[level]);
        }
        builder.push(")");
    }
}

fn push_cursor_bind(builder: &mut QueryBuilder<'_, Sqlite>, value: &CursorValue) {
    match value {
        CursorValue::Integer(value) => {
            builder.push_bind(*value);
        }
        CursorValue::Text(value) => {
            builder.push_bind(value.clone());
        }
    }
}

fn track_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<TrackSummary, LibraryError> {
    Ok(TrackSummary {
        album: row.try_get("album").map_err(|_| LibraryError::database())?,
        artist: row
            .try_get("artist")
            .map_err(|_| LibraryError::database())?,
        codec: row.try_get("codec").map_err(|_| LibraryError::database())?,
        date: row.try_get("date").map_err(|_| LibraryError::database())?,
        date_added: row
            .try_get("dateAdded")
            .map_err(|_| LibraryError::database())?,
        duration: row
            .try_get("duration")
            .map_err(|_| LibraryError::database())?,
        favor_rating: row
            .try_get("favorRating")
            .map_err(|_| LibraryError::database())?,
        file: row.try_get("file").map_err(|_| LibraryError::database())?,
        id: row.try_get("id").map_err(|_| LibraryError::database())?,
        path: row.try_get("path").map_err(|_| LibraryError::database())?,
        sample_rate: row
            .try_get("sampleRate")
            .map_err(|_| LibraryError::database())?,
        side: row.try_get("side").map_err(|_| LibraryError::database())?,
        start_time: row
            .try_get("startTime")
            .map_err(|_| LibraryError::database())?,
        title: row.try_get("title").map_err(|_| LibraryError::database())?,
        track_number: row
            .try_get("trackNumber")
            .map_err(|_| LibraryError::database())?,
        visuals_path: row
            .try_get("visualsPath")
            .map_err(|_| LibraryError::database())?,
    })
}

fn sort_values(track: &TrackSummary, sort: TrackSort) -> Vec<CursorValue> {
    match sort {
        TrackSort::Default => vec![
            CursorValue::Text(track.artist.clone()),
            CursorValue::Text(track.album.clone()),
            CursorValue::Integer(track.side),
            CursorValue::Integer(track.track_number),
            CursorValue::Text(track.title.clone()),
        ],
        TrackSort::Album => vec![
            CursorValue::Text(track.album.clone()),
            CursorValue::Text(track.artist.clone()),
            CursorValue::Integer(track.track_number),
        ],
        TrackSort::Artist => vec![
            CursorValue::Text(track.artist.clone()),
            CursorValue::Text(track.album.clone()),
            CursorValue::Integer(track.track_number),
        ],
        TrackSort::Date => vec![CursorValue::Integer(track.date.parse().unwrap_or(0))],
        TrackSort::DateAdded => vec![CursorValue::Text(track.date_added.clone())],
        TrackSort::Favorite => vec![CursorValue::Integer(track.favor_rating)],
        TrackSort::SampleRate => vec![CursorValue::Integer(track.sample_rate.parse().unwrap_or(0))],
        TrackSort::Title => vec![CursorValue::Text(track.title.clone())],
        TrackSort::Track => vec![
            CursorValue::Integer(track.track_number),
            CursorValue::Text(track.title.clone()),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    async fn repository() -> LibraryRepository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open repository database");
        sqlx::raw_sql(crate::database::INITIAL_SCHEMA)
            .execute(&pool)
            .await
            .expect("apply initial schema");
        sqlx::raw_sql(crate::database::CATALOG_QUERY_SCHEMA)
            .execute(&pool)
            .await
            .expect("apply catalog query schema");
        for index in 0..23 {
            sqlx::query(
                "INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(format!("song-{index:02}"))
            .bind(format!("/music/song-{index:02}.flac"))
            .bind(format!("song-{index:02}.flac"))
            .bind(if index < 3 { "Duplicate".to_owned() } else { format!("Song {index:02}") })
            .bind(if index == 22 { "Unicode" } else { "Album" })
            .bind(if index == 22 { "Björk" } else { "Artist" })
            .bind("")
            .bind(0_i64)
            .bind(0_i64)
            .bind("2026")
            .bind("")
            .bind(23_i64)
            .bind((index % 5) as i64)
            .bind("flac")
            .bind("0:01:00.000")
            .bind("44100")
            .bind((index % 2 + 1) as i64)
            .bind(0_i64)
            .bind((index % 3) as i64)
            .bind(format!("2026-08-{:02}", index + 1))
            .bind("")
            .execute(&pool)
            .await
            .expect("insert repository fixture song");
        }
        LibraryRepository::new(pool)
    }

    #[test]
    fn pages_have_stable_continuity_without_duplicates_or_omissions() {
        run_async(async {
            let repository = repository().await;
            let mut cursor = None;
            let mut ids = Vec::new();
            let mut revisions = Vec::new();
            loop {
                let page = repository
                    .query_tracks(TrackQuery {
                        cursor,
                        limit: 5,
                        ..TrackQuery::default()
                    })
                    .await
                    .expect("query page");
                revisions.push(page.revision);
                ids.extend(page.items.into_iter().map(|track| track.id));
                cursor = page.next_cursor;
                if cursor.is_none() {
                    break;
                }
            }

            let unique = ids.iter().collect::<std::collections::HashSet<_>>();
            assert_eq!(ids.len(), 23);
            assert_eq!(unique.len(), 23);
            assert!(revisions.iter().all(|revision| *revision == 23));
        });
    }

    #[test]
    fn search_is_fts_backed_unicode_safe_and_bounded() {
        run_async(async {
            let repository = repository().await;
            let page = repository
                .query_tracks(TrackQuery {
                    limit: 1000,
                    q: "Björk".to_owned(),
                    ..TrackQuery::default()
                })
                .await
                .expect("query Unicode search");

            assert_eq!(page.items.len(), 1);
            assert_eq!(page.items[0].artist, "Björk");
            assert_eq!(page.total, 1);
            assert_eq!(page.next_cursor, None);
        });
    }

    #[test]
    fn exact_artist_and_album_filters_bound_drill_down_queries() {
        run_async(async {
            let repository = repository().await;
            let artist = repository
                .query_tracks(TrackQuery {
                    artist: Some("Björk".to_owned()),
                    limit: 100,
                    ..TrackQuery::default()
                })
                .await
                .expect("filter artist tracks");
            assert_eq!(artist.total, 1);
            assert_eq!(artist.items[0].artist, "Björk");

            let album = repository
                .query_tracks(TrackQuery {
                    album: Some("Album".to_owned()),
                    artist: Some("Artist".to_owned()),
                    limit: 100,
                    ..TrackQuery::default()
                })
                .await
                .expect("filter album tracks");
            assert_eq!(album.total, 22);
            assert!(album
                .items
                .iter()
                .all(|track| track.artist == "Artist" && track.album == "Album"));
        });
    }

    #[test]
    fn stale_cursor_is_rejected_after_any_catalog_mutation() {
        run_async(async {
            let repository = repository().await;
            let first = repository
                .query_tracks(TrackQuery {
                    limit: 5,
                    ..TrackQuery::default()
                })
                .await
                .expect("query first page");
            sqlx::query("UPDATE songs SET title = title || ' changed' WHERE id = 'song-00'")
                .execute(&repository.pool)
                .await
                .expect("mutate catalog");

            let error = repository
                .query_tracks(TrackQuery {
                    cursor: first.next_cursor,
                    limit: 5,
                    ..TrackQuery::default()
                })
                .await
                .expect_err("reject stale page");

            assert_eq!(error.code, "stale_cursor");
        });
    }

    #[test]
    fn every_sort_direction_preserves_page_continuity() {
        run_async(async {
            let repository = repository().await;
            let sorts = [
                TrackSort::Default,
                TrackSort::Album,
                TrackSort::Artist,
                TrackSort::Date,
                TrackSort::DateAdded,
                TrackSort::Favorite,
                TrackSort::SampleRate,
                TrackSort::Title,
                TrackSort::Track,
            ];
            for sort in sorts {
                for direction in [SortDirection::Asc, SortDirection::Desc] {
                    let first = repository
                        .query_tracks(TrackQuery {
                            direction,
                            limit: 7,
                            sort,
                            ..TrackQuery::default()
                        })
                        .await
                        .expect("query first sorted page");
                    let second = repository
                        .query_tracks(TrackQuery {
                            cursor: first.next_cursor.clone(),
                            direction,
                            limit: 7,
                            sort,
                            ..TrackQuery::default()
                        })
                        .await
                        .expect("query second sorted page");
                    assert_eq!(first.items.len(), 7);
                    assert_eq!(second.items.len(), 7);
                    assert!(first
                        .items
                        .iter()
                        .all(|left| second.items.iter().all(|right| left.id != right.id)));
                }
            }
        });
    }

    #[test]
    fn invalid_sort_names_fail_contract_deserialization() {
        let result = serde_json::from_value::<TrackQuery>(serde_json::json!({
            "sort": "not_a_sort"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn representative_query_plans_keep_browse_and_search_indexed() {
        run_async(async {
            let repository = repository().await;
            let browse_plan = sqlx::query(
                "EXPLAIN QUERY PLAN
                 SELECT id, path, file, title, album, artist, date, trackNumber, codec,
                        duration, sampleRate, side, startTime, favorRating, dateAdded, visualsPath
                 FROM songs
                 ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, side,
                          trackNumber, title COLLATE NOCASE, id COLLATE BINARY
                 LIMIT 101",
            )
            .fetch_all(&repository.pool)
            .await
            .expect("explain indexed browse")
            .into_iter()
            .map(|row| {
                row.try_get::<String, _>("detail")
                    .expect("read plan detail")
            })
            .collect::<Vec<_>>()
            .join("\n");
            assert!(browse_plan.contains("idx_songs_default_browse"));
            assert!(!browse_plan.contains("USE TEMP B-TREE"));

            let search_plan = sqlx::query(
                r#"EXPLAIN QUERY PLAN
                   SELECT id, path, file, title, album, artist, date, trackNumber, codec,
                          duration, sampleRate, side, startTime, favorRating, dateAdded, visualsPath
                   FROM songs
                   WHERE id IN (
                     SELECT song_id FROM songs_fts WHERE songs_fts MATCH '"Björk"'
                   )
                   ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, side,
                            trackNumber, title COLLATE NOCASE, id COLLATE BINARY
                   LIMIT 101"#,
            )
            .fetch_all(&repository.pool)
            .await
            .expect("explain FTS search")
            .into_iter()
            .map(|row| {
                row.try_get::<String, _>("detail")
                    .expect("read plan detail")
            })
            .collect::<Vec<_>>()
            .join("\n");
            assert!(search_plan.contains("VIRTUAL TABLE INDEX"));
        });
    }
}

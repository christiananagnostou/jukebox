use super::query::{LibraryError, NormalizedTrackQuery, TrackQuery, MAX_PAGE_SIZE};
use super::repository::{fts_expression, push_track_filters, FilterExclusion};
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};

const MAX_FACET_OFFSET: u32 = 100_000;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackFacet {
    Codec,
    #[default]
    Genre,
    Year,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FacetQuery {
    pub filters: TrackQuery,
    pub kind: TrackFacet,
    pub limit: u32,
    pub offset: u32,
}

impl Default for FacetQuery {
    fn default() -> Self {
        Self {
            filters: TrackQuery::default(),
            kind: TrackFacet::default(),
            limit: 50,
            offset: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetItem {
    pub count: i64,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetPage {
    pub items: Vec<FacetItem>,
    pub revision: i64,
    pub total: i64,
}

struct NormalizedFacetQuery {
    filters: NormalizedTrackQuery,
    kind: TrackFacet,
    limit: u32,
    offset: u32,
}

impl FacetQuery {
    fn normalize(&self) -> Result<NormalizedFacetQuery, LibraryError> {
        if self.limit == 0 {
            return Err(LibraryError::invalid_query(
                "Facet page size must be at least one.",
            ));
        }
        if self.offset > MAX_FACET_OFFSET {
            return Err(LibraryError::invalid_query("Facet offset is too large."));
        }
        if self.filters.cursor.is_some() {
            return Err(LibraryError::invalid_query(
                "Facet filters cannot include a track cursor.",
            ));
        }
        Ok(NormalizedFacetQuery {
            filters: self.filters.normalize()?,
            kind: self.kind,
            limit: self.limit.min(MAX_PAGE_SIZE),
            offset: self.offset,
        })
    }
}

struct FacetSql {
    exclusion: FilterExclusion,
    group: &'static str,
    nonempty: &'static str,
    value: &'static str,
}

fn facet_sql(kind: TrackFacet) -> FacetSql {
    match kind {
        TrackFacet::Codec => FacetSql {
            exclusion: FilterExclusion::Codec,
            group: "codec COLLATE NOCASE",
            nonempty: "TRIM(codec) <> ''",
            value: "MIN(codec)",
        },
        TrackFacet::Genre => FacetSql {
            exclusion: FilterExclusion::Genre,
            group: "genre COLLATE NOCASE",
            nonempty: "TRIM(genre) <> ''",
            value: "MIN(genre)",
        },
        TrackFacet::Year => FacetSql {
            exclusion: FilterExclusion::Year,
            group: "CAST(date AS INTEGER)",
            nonempty: "CAST(date AS INTEGER) BETWEEN 1 AND 9999",
            value: "CAST(CAST(date AS INTEGER) AS TEXT)",
        },
    }
}

fn push_nonempty(
    builder: &mut QueryBuilder<'_, Sqlite>,
    expression: &'static str,
    has_where: bool,
) {
    builder
        .push(if has_where { " AND " } else { " WHERE " })
        .push(expression);
}

pub(crate) async fn load_facet_page(
    pool: &SqlitePool,
    query: FacetQuery,
) -> Result<FacetPage, LibraryError> {
    let query = query.normalize()?;
    let sql = facet_sql(query.kind);
    let search = fts_expression(&query.filters.q);
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM catalog_meta WHERE id = 1")
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;

    let mut count = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM (SELECT ");
    count.push(sql.group).push(" FROM songs");
    let has_filter = push_track_filters(
        &mut count,
        &query.filters,
        search.as_deref(),
        Some(sql.exclusion),
    );
    push_nonempty(&mut count, sql.nonempty, has_filter);
    count.push(" GROUP BY ").push(sql.group).push(")");
    let total = count
        .build_query_scalar::<i64>()
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;

    let mut page = QueryBuilder::<Sqlite>::new("SELECT ");
    page.push(sql.value)
        .push(" AS value, COUNT(*) AS count FROM songs");
    let has_filter = push_track_filters(
        &mut page,
        &query.filters,
        search.as_deref(),
        Some(sql.exclusion),
    );
    push_nonempty(&mut page, sql.nonempty, has_filter);
    page.push(" GROUP BY ")
        .push(sql.group)
        .push(" ORDER BY count DESC, value COLLATE NOCASE, value COLLATE BINARY LIMIT ")
        .push_bind(i64::from(query.limit))
        .push(" OFFSET ")
        .push_bind(i64::from(query.offset));
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
            Ok(FacetItem {
                count: row.try_get("count").map_err(|_| LibraryError::database())?,
                value: row.try_get("value").map_err(|_| LibraryError::database())?,
            })
        })
        .collect::<Result<Vec<_>, LibraryError>>()?;
    Ok(FacetPage {
        items,
        revision,
        total,
    })
}

#[cfg(test)]
mod tests {
    use super::super::query::TrackAvailability;
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn fixture() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open facet fixture");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate facet fixture");
        for (id, title, genre, codec, date, favorite, availability) in [
            ("one", "One", "Ambient", "flac", "2024", 2, "available"),
            ("two", "Two", "ambient", "flac", "2024-08", 1, "available"),
            ("three", "Three", "Jazz", "mp3", "1999", 0, "unavailable"),
            ("four", "Four", "", "wav", "unknown", 2, "available"),
        ] {
            sqlx::query(
                "INSERT INTO songs (
                    id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
                    trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
                    favorRating, dateAdded, visualsPath, availability
                 ) VALUES (?, ?, ?, ?, 'Album', 'Artist', ?, 0, 0, ?, '', 1, 1, ?,
                           '0:03:00.000', '44100', 1, 0, ?, '2026-08-27', '', ?)",
            )
            .bind(id)
            .bind(format!("/music/{id}"))
            .bind(format!("{id}.{codec}"))
            .bind(title)
            .bind(genre)
            .bind(date)
            .bind(codec)
            .bind(favorite)
            .bind(availability)
            .execute(&pool)
            .await
            .expect("insert facet track");
        }
        pool
    }

    #[test]
    fn facet_pages_are_bounded_deterministic_and_self_excluding() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let page = load_facet_page(
                &pool,
                FacetQuery {
                    filters: TrackQuery {
                        availability: TrackAvailability::Available,
                        genre: Some("Jazz".to_owned()),
                        min_favorite_rating: Some(1),
                        ..TrackQuery::default()
                    },
                    kind: TrackFacet::Genre,
                    limit: 1,
                    offset: 0,
                },
            )
            .await
            .expect("load genre facets");

            assert_eq!(page.total, 1);
            assert_eq!(page.items.len(), 1);
            assert_eq!(page.items[0].count, 2);
            assert_eq!(page.items[0].value.to_lowercase(), "ambient");

            let years = load_facet_page(
                &pool,
                FacetQuery {
                    kind: TrackFacet::Year,
                    ..FacetQuery::default()
                },
            )
            .await
            .expect("load year facets");
            assert_eq!(
                years.items[0],
                FacetItem {
                    count: 2,
                    value: "2024".to_owned()
                }
            );
            assert_eq!(years.total, 2);
        });
    }

    #[test]
    fn facet_contract_rejects_unbounded_or_cursor_queries() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            for query in [
                FacetQuery {
                    limit: 0,
                    ..FacetQuery::default()
                },
                FacetQuery {
                    offset: MAX_FACET_OFFSET + 1,
                    ..FacetQuery::default()
                },
                FacetQuery {
                    filters: TrackQuery {
                        cursor: Some("opaque".to_owned()),
                        ..TrackQuery::default()
                    },
                    ..FacetQuery::default()
                },
            ] {
                assert_eq!(
                    load_facet_page(&pool, query)
                        .await
                        .expect_err("reject invalid facet")
                        .code,
                    "invalid_query"
                );
            }
        });
    }
}

use super::query::{LibraryError, MAX_PAGE_SIZE};
use super::repository::{track_from_row, TrackSummary};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

const MAX_COLLECTION_OFFSET: u32 = 100_000;

const RECENT_COUNT: &str = "SELECT COUNT(*) FROM (
       SELECT history.track_id
       FROM play_history AS history
       JOIN songs ON songs.id = history.track_id
       WHERE songs.availability = 'available'
       GROUP BY history.track_id
     )";

const RECENT_PAGE: &str = "WITH history_metrics AS (
       SELECT track_id, SUM(completed) AS play_count, SUM(listened_ms) AS listened_ms,
              MAX(started_at) AS last_played_at, MAX(id) AS last_history_id
       FROM play_history
       GROUP BY track_id
     )
     SELECT songs.id, songs.path, songs.file, songs.title, songs.album, songs.artist,
            songs.genre, songs.bpm, songs.compilation, songs.date, songs.encoder,
            songs.trackTotal, songs.trackNumber, songs.codec, songs.duration,
            songs.sampleRate, songs.side, songs.startTime, songs.favorRating,
            songs.dateAdded, songs.visualsPath, history_metrics.play_count,
            history_metrics.listened_ms, history_metrics.last_played_at
     FROM history_metrics
     JOIN songs ON songs.id = history_metrics.track_id
     WHERE songs.availability = 'available'
     ORDER BY history_metrics.last_history_id DESC, songs.id COLLATE BINARY ASC
     LIMIT ? OFFSET ?";

const MOST_PLAYED_COUNT: &str = "SELECT COUNT(*) FROM (
       SELECT history.track_id
       FROM play_history AS history
       JOIN songs ON songs.id = history.track_id
       WHERE history.completed = 1 AND songs.availability = 'available'
       GROUP BY history.track_id
     )";

const MOST_PLAYED_PAGE: &str = "WITH history_metrics AS (
       SELECT track_id, COUNT(*) AS play_count, SUM(listened_ms) AS listened_ms,
              MAX(started_at) AS last_played_at, MAX(id) AS last_history_id
       FROM play_history
       WHERE completed = 1
       GROUP BY track_id
     )
     SELECT songs.id, songs.path, songs.file, songs.title, songs.album, songs.artist,
            songs.genre, songs.bpm, songs.compilation, songs.date, songs.encoder,
            songs.trackTotal, songs.trackNumber, songs.codec, songs.duration,
            songs.sampleRate, songs.side, songs.startTime, songs.favorRating,
            songs.dateAdded, songs.visualsPath, history_metrics.play_count,
            history_metrics.listened_ms, history_metrics.last_played_at
     FROM history_metrics
     JOIN songs ON songs.id = history_metrics.track_id
     WHERE songs.availability = 'available'
     ORDER BY history_metrics.play_count DESC, history_metrics.last_history_id DESC,
              songs.id COLLATE BINARY ASC
     LIMIT ? OFFSET ?";

const NEVER_PLAYED_COUNT: &str = "SELECT COUNT(*)
     FROM songs
     WHERE availability = 'available'
       AND NOT EXISTS (
         SELECT 1 FROM play_history AS history WHERE history.track_id = songs.id
       )";

const NEVER_PLAYED_PAGE: &str =
    "SELECT songs.id, songs.path, songs.file, songs.title, songs.album, songs.artist,
            songs.genre, songs.bpm, songs.compilation, songs.date, songs.encoder,
            songs.trackTotal, songs.trackNumber, songs.codec, songs.duration,
            songs.sampleRate, songs.side, songs.startTime, songs.favorRating,
            songs.dateAdded, songs.visualsPath, 0 AS play_count, 0 AS listened_ms,
            NULL AS last_played_at
     FROM songs
     WHERE songs.availability = 'available'
       AND NOT EXISTS (
         SELECT 1 FROM play_history AS history WHERE history.track_id = songs.id
       )
     ORDER BY songs.artist COLLATE NOCASE ASC, songs.album COLLATE NOCASE ASC,
              songs.side ASC, songs.trackNumber ASC, songs.title COLLATE NOCASE ASC,
              songs.id COLLATE BINARY ASC
     LIMIT ? OFFSET ?";

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub enum BuiltInCollectionKind {
    #[default]
    #[serde(rename = "recently_played")]
    Recent,
    #[serde(rename = "most_played")]
    Frequent,
    #[serde(rename = "never_played")]
    Unplayed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BuiltInCollectionQuery {
    pub kind: BuiltInCollectionKind,
    pub limit: u32,
    pub offset: u32,
}

impl Default for BuiltInCollectionQuery {
    fn default() -> Self {
        Self {
            kind: BuiltInCollectionKind::default(),
            limit: 50,
            offset: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInCollectionItem {
    pub last_played_at: Option<String>,
    pub listened_ms: u64,
    pub play_count: u64,
    pub track: TrackSummary,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInCollectionPage {
    pub items: Vec<BuiltInCollectionItem>,
    pub revision: String,
    pub total: i64,
}

#[derive(Debug)]
struct NormalizedCollectionQuery {
    kind: BuiltInCollectionKind,
    limit: u32,
    offset: u32,
}

impl BuiltInCollectionQuery {
    fn normalize(self) -> Result<NormalizedCollectionQuery, LibraryError> {
        if self.limit == 0 {
            return Err(LibraryError::invalid_query(
                "Built-in collection page size must be at least one.",
            ));
        }
        if self.offset > MAX_COLLECTION_OFFSET {
            return Err(LibraryError::invalid_query(
                "Built-in collection offset is outside the supported range.",
            ));
        }
        Ok(NormalizedCollectionQuery {
            kind: self.kind,
            limit: self.limit.min(MAX_PAGE_SIZE),
            offset: self.offset,
        })
    }
}

pub(crate) async fn load_built_in_collection(
    pool: &SqlitePool,
    query: BuiltInCollectionQuery,
) -> Result<BuiltInCollectionPage, LibraryError> {
    let query = query.normalize()?;
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    let catalog_revision: i64 =
        sqlx::query_scalar("SELECT revision FROM catalog_meta WHERE id = 1")
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?;
    let (last_history_id, completed_plays): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(MAX(id), 0), COALESCE(SUM(completed), 0) FROM play_history",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?;
    let (count_sql, page_sql) = match query.kind {
        BuiltInCollectionKind::Recent => (RECENT_COUNT, RECENT_PAGE),
        BuiltInCollectionKind::Frequent => (MOST_PLAYED_COUNT, MOST_PLAYED_PAGE),
        BuiltInCollectionKind::Unplayed => (NEVER_PLAYED_COUNT, NEVER_PLAYED_PAGE),
    };
    let total = sqlx::query_scalar(count_sql)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    let rows = sqlx::query(page_sql)
        .bind(i64::from(query.limit))
        .bind(i64::from(query.offset))
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;

    Ok(BuiltInCollectionPage {
        items: rows
            .iter()
            .map(collection_item_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        revision: format!("{catalog_revision}:{last_history_id}:{completed_plays}"),
        total,
    })
}

fn collection_item_from_row(
    row: &sqlx::sqlite::SqliteRow,
) -> Result<BuiltInCollectionItem, LibraryError> {
    let play_count = row
        .try_get::<i64, _>("play_count")
        .map_err(|_| LibraryError::database())?;
    let listened_ms = row
        .try_get::<i64, _>("listened_ms")
        .map_err(|_| LibraryError::database())?;
    Ok(BuiltInCollectionItem {
        last_played_at: row
            .try_get("last_played_at")
            .map_err(|_| LibraryError::database())?,
        listened_ms: u64::try_from(listened_ms).map_err(|_| LibraryError::database())?,
        play_count: u64::try_from(play_count).map_err(|_| LibraryError::database())?,
        track: track_from_row(row)?,
    })
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
            .expect("open built-in collection fixture");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate built-in collection fixture");
        sqlx::raw_sql(
            "INSERT INTO songs (
               id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
               trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
               favorRating, dateAdded, visualsPath, availability
             ) VALUES
               ('alpha', '/music/alpha.flac', 'alpha.flac', 'Alpha', 'First', 'Artist', '',
                0, 0, '2026', '', 2, 1, 'flac', '0:02:00.000', '44100', 1, 0, 0,
                '2026-08-27', '', 'available'),
               ('beta', '/music/beta.flac', 'beta.flac', 'Beta', 'First', 'Artist', '',
                0, 0, '2026', '', 2, 2, 'flac', '0:02:00.000', '44100', 1, 0, 0,
                '2026-08-27', '', 'available'),
               ('gamma', '/music/gamma.flac', 'gamma.flac', 'Gamma', 'Second', 'Another', '',
                0, 0, '2026', '', 1, 1, 'flac', '0:02:00.000', '44100', 1, 0, 0,
                '2026-08-27', '', 'available'),
               ('hidden', '/music/hidden.flac', 'hidden.flac', 'Hidden', 'Second', 'Another', '',
                0, 0, '2026', '', 1, 1, 'flac', '0:02:00.000', '44100', 1, 0, 0,
                '2026-08-27', '', 'unavailable');
             INSERT INTO play_history (
               track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind,
               started_at, ended_at, updated_at, listened_ms, position_ms, duration_ms,
               completed, open_slot
             ) VALUES
               ('alpha', 'Alpha', 'Artist', 'First', 'context',
                '2026-08-27T01:00:00.000Z', '2026-08-27T01:01:00.000Z',
                '2026-08-27T01:01:00.000Z', 60000, 60000, 120000, 1, NULL),
               ('alpha', 'Alpha', 'Artist', 'First', 'queue',
                '2026-08-27T02:00:00.000Z', '2026-08-27T02:01:00.000Z',
                '2026-08-27T02:01:00.000Z', 70000, 70000, 120000, 1, NULL),
               ('beta', 'Beta', 'Artist', 'First', 'context',
                '2026-08-27T03:00:00.000Z', '2026-08-27T03:00:10.000Z',
                '2026-08-27T03:00:10.000Z', 10000, 10000, 120000, 0, NULL),
               ('hidden', 'Hidden', 'Another', 'Second', 'context',
                '2026-08-27T04:00:00.000Z', '2026-08-27T04:01:00.000Z',
                '2026-08-27T04:01:00.000Z', 60000, 60000, 120000, 1, NULL);",
        )
        .execute(&pool)
        .await
        .expect("load built-in collection fixture");
        pool
    }

    fn query(kind: BuiltInCollectionKind) -> BuiltInCollectionQuery {
        BuiltInCollectionQuery {
            kind,
            limit: 100,
            offset: 0,
        }
    }

    #[test]
    fn collection_contract_rejects_unbounded_queries_and_unknown_kinds() {
        assert_eq!(
            BuiltInCollectionQuery {
                limit: 0,
                ..BuiltInCollectionQuery::default()
            }
            .normalize()
            .expect_err("reject zero collection page")
            .code,
            "invalid_query"
        );
        assert_eq!(
            BuiltInCollectionQuery {
                offset: MAX_COLLECTION_OFFSET + 1,
                ..BuiltInCollectionQuery::default()
            }
            .normalize()
            .expect_err("reject unbounded collection offset")
            .code,
            "invalid_query"
        );
        assert!(
            serde_json::from_value::<BuiltInCollectionQuery>(serde_json::json!({
                "kind": "custom_sql",
                "limit": 10,
                "offset": 0
            }))
            .is_err()
        );
        assert_eq!(
            BuiltInCollectionQuery {
                limit: 500,
                ..BuiltInCollectionQuery::default()
            }
            .normalize()
            .expect("clamp collection page")
            .limit,
            MAX_PAGE_SIZE
        );
    }

    #[test]
    fn built_in_collections_are_unique_playable_and_completion_aware() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let recent = load_built_in_collection(&pool, query(BuiltInCollectionKind::Recent))
                .await
                .expect("load recently played");
            assert_eq!(recent.total, 2);
            assert_eq!(
                recent
                    .items
                    .iter()
                    .map(|item| item.track.id.as_str())
                    .collect::<Vec<_>>(),
                ["beta", "alpha"]
            );
            assert_eq!(recent.items[0].play_count, 0);
            assert_eq!(recent.items[0].listened_ms, 10_000);
            assert_eq!(recent.items[1].play_count, 2);
            assert_eq!(recent.items[1].listened_ms, 130_000);

            let most = load_built_in_collection(&pool, query(BuiltInCollectionKind::Frequent))
                .await
                .expect("load most played");
            assert_eq!(most.total, 1);
            assert_eq!(most.items[0].track.id, "alpha");
            assert_eq!(most.items[0].play_count, 2);
            assert_eq!(most.items[0].listened_ms, 130_000);

            let never = load_built_in_collection(&pool, query(BuiltInCollectionKind::Unplayed))
                .await
                .expect("load never played");
            assert_eq!(never.total, 1);
            assert_eq!(never.items[0].track.id, "gamma");
            assert_eq!(never.items[0].play_count, 0);
            assert!(never.items[0].last_played_at.is_none());

            let second_recent = load_built_in_collection(
                &pool,
                BuiltInCollectionQuery {
                    kind: BuiltInCollectionKind::Recent,
                    limit: 1,
                    offset: 1,
                },
            )
            .await
            .expect("page recently played");
            assert_eq!(second_recent.items[0].track.id, "alpha");
        });
    }

    #[test]
    fn collection_revision_changes_with_history_completion_and_catalog_updates() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let initial = load_built_in_collection(&pool, query(BuiltInCollectionKind::Recent))
                .await
                .expect("load initial collection revision");
            sqlx::query(
                "INSERT INTO play_history (
                   track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind,
                   ended_at, listened_ms, position_ms, duration_ms, completed, open_slot
                 ) VALUES ('beta', 'Beta', 'Artist', 'First', 'queue',
                           STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'), 60000, 60000, 120000, 1, NULL)",
            )
            .execute(&pool)
            .await
            .expect("insert completed history row");
            let history_changed =
                load_built_in_collection(&pool, query(BuiltInCollectionKind::Recent))
                    .await
                    .expect("load history revision");
            assert_ne!(initial.revision, history_changed.revision);

            sqlx::query("UPDATE songs SET title = 'Beta revised' WHERE id = 'beta'")
                .execute(&pool)
                .await
                .expect("update catalog track");
            let catalog_changed =
                load_built_in_collection(&pool, query(BuiltInCollectionKind::Recent))
                    .await
                    .expect("load catalog revision");
            assert_ne!(history_changed.revision, catalog_changed.revision);
            assert_eq!(catalog_changed.items[0].track.title, "Beta revised");
        });
    }

    #[test]
    fn collection_query_plans_use_history_and_availability_indexes() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let completed = sqlx::query(
                "EXPLAIN QUERY PLAN
                 SELECT track_id FROM play_history
                 WHERE completed = 1 GROUP BY track_id",
            )
            .fetch_all(&pool)
            .await
            .expect("inspect completed history plan")
            .iter()
            .map(|row| row.get::<String, _>("detail"))
            .collect::<Vec<_>>()
            .join(" ");
            assert!(completed.contains("idx_play_history_completed_track"));

            let never = sqlx::query(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM songs
                 WHERE availability = 'available'
                   AND NOT EXISTS (
                     SELECT 1 FROM play_history AS history WHERE history.track_id = songs.id
                   )
                 ORDER BY id LIMIT 100",
            )
            .fetch_all(&pool)
            .await
            .expect("inspect never-played plan")
            .iter()
            .map(|row| row.get::<String, _>("detail"))
            .collect::<Vec<_>>()
            .join(" ");
            assert!(never.contains("idx_songs_availability_filter"));
            assert!(never.contains("idx_play_history_track"));
        });
    }
}

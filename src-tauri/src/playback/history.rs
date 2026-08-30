use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tokio::sync::{mpsc, oneshot, Mutex, OnceCell};

const COMPLETION_CAP_MS: u64 = 4 * 60 * 1_000;
const MAX_FORWARD_DELTA_MS: u64 = 10_000;
const MAX_PENDING_EVENTS: usize = 256;
const MAX_HISTORY_ROWS: i64 = 10_000;
const MAX_OFFSET: u32 = 100_000;
const MAX_PAGE_SIZE: u32 = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum HistorySource {
    Context,
    Queue,
}

impl HistorySource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Context => "context",
            Self::Queue => "queue",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ListeningSample {
    pub duration_ms: u64,
    pub instance_key: String,
    pub playing: bool,
    pub position_ms: u64,
    pub source: HistorySource,
    pub track_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlayHistoryQuery {
    limit: u32,
    offset: u32,
}

impl Default for PlayHistoryQuery {
    fn default() -> Self {
        Self {
            limit: 50,
            offset: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryItem {
    pub album: String,
    pub artist: String,
    pub availability: String,
    pub completed: bool,
    pub duration_ms: u64,
    pub ended_at: Option<String>,
    pub id: i64,
    pub listened_ms: u64,
    pub position_ms: u64,
    pub source_kind: String,
    pub started_at: String,
    pub title: String,
    pub track_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayHistoryPage {
    pub items: Vec<PlayHistoryItem>,
    pub total: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PlayHistoryMutation {
    pub affected: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PlayHistoryError {
    pub code: &'static str,
    pub message: &'static str,
}

impl PlayHistoryError {
    pub(super) fn unavailable() -> Self {
        Self {
            code: "play_history_unavailable",
            message: "Listening history is temporarily unavailable.",
        }
    }

    fn invalid_query() -> Self {
        Self {
            code: "invalid_query",
            message: "The listening-history page is outside the supported range.",
        }
    }
}

#[derive(Clone)]
struct PlayHistoryRepository {
    pool: SqlitePool,
}

impl PlayHistoryRepository {
    fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn recover_stale_open_row(&self) -> Result<(), PlayHistoryError> {
        sqlx::query(
            "UPDATE play_history
             SET ended_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 completed = CASE
                   WHEN duration_ms > 0
                    AND listened_ms >= MIN((duration_ms + 1) / 2, ?)
                   THEN 1 ELSE 0 END,
                 open_slot = NULL
             WHERE open_slot = 1",
        )
        .bind(i64::try_from(COMPLETION_CAP_MS).map_err(|_| PlayHistoryError::unavailable())?)
        .execute(&self.pool)
        .await
        .map_err(|_| PlayHistoryError::unavailable())?;
        self.prune().await
    }

    async fn start(
        &self,
        track_id: &str,
        source: HistorySource,
    ) -> Result<Option<i64>, PlayHistoryError> {
        let id = sqlx::query_scalar(
            "INSERT INTO play_history (
               track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind
             )
             SELECT id, SUBSTR(title, 1, 1024), SUBSTR(artist, 1, 1024),
                    SUBSTR(album, 1, 1024), ?
             FROM songs
             WHERE id = ? AND availability = 'available'
             RETURNING id",
        )
        .bind(source.as_str())
        .bind(track_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| PlayHistoryError::unavailable())?;
        Ok(id)
    }

    async fn checkpoint(&self, active: &ActiveListening) -> Result<(), PlayHistoryError> {
        sqlx::query(
            "UPDATE play_history
             SET listened_ms = ?, position_ms = ?, duration_ms = ?,
                 updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ? AND open_slot = 1",
        )
        .bind(as_i64(active.listened_ms)?)
        .bind(as_i64(active.position_ms)?)
        .bind(as_i64(active.duration_ms)?)
        .bind(active.row_id)
        .execute(&self.pool)
        .await
        .map_err(|_| PlayHistoryError::unavailable())?;
        Ok(())
    }

    async fn finish(&self, active: &ActiveListening) -> Result<(), PlayHistoryError> {
        sqlx::query(
            "UPDATE play_history
             SET listened_ms = ?, position_ms = ?, duration_ms = ?, completed = ?,
                 ended_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'),
                 updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'), open_slot = NULL
             WHERE id = ? AND open_slot = 1",
        )
        .bind(as_i64(active.listened_ms)?)
        .bind(as_i64(active.position_ms)?)
        .bind(as_i64(active.duration_ms)?)
        .bind(i64::from(is_complete(
            active.listened_ms,
            active.duration_ms,
        )))
        .bind(active.row_id)
        .execute(&self.pool)
        .await
        .map_err(|_| PlayHistoryError::unavailable())?;
        self.prune().await
    }

    async fn prune(&self) -> Result<(), PlayHistoryError> {
        sqlx::query(
            "DELETE FROM play_history
             WHERE id IN (
               SELECT id FROM play_history
               WHERE ended_at IS NOT NULL
               ORDER BY started_at DESC, id DESC
               LIMIT -1 OFFSET ?
             )",
        )
        .bind(MAX_HISTORY_ROWS)
        .execute(&self.pool)
        .await
        .map_err(|_| PlayHistoryError::unavailable())?;
        Ok(())
    }

    async fn page(&self, query: PlayHistoryQuery) -> Result<PlayHistoryPage, PlayHistoryError> {
        if query.limit == 0 || query.offset > MAX_OFFSET {
            return Err(PlayHistoryError::invalid_query());
        }
        let limit = query.limit.min(MAX_PAGE_SIZE);
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PlayHistoryError::unavailable())?;
        let total = sqlx::query_scalar("SELECT COUNT(*) FROM play_history")
            .fetch_one(&mut *transaction)
            .await
            .map_err(|_| PlayHistoryError::unavailable())?;
        let rows = sqlx::query(
            "SELECT history.id, history.track_id,
                    COALESCE(songs.title, history.title_snapshot) AS title,
                    COALESCE(songs.artist, history.artist_snapshot) AS artist,
                    COALESCE(songs.album, history.album_snapshot) AS album,
                    CASE WHEN songs.id IS NULL THEN 'missing' ELSE songs.availability END AS availability,
                    history.source_kind, history.started_at, history.ended_at,
                    history.listened_ms, history.position_ms, history.duration_ms,
                    history.completed
             FROM play_history AS history
             LEFT JOIN songs ON songs.id = history.track_id
             ORDER BY history.started_at DESC, history.id DESC
             LIMIT ? OFFSET ?",
        )
        .bind(i64::from(limit))
        .bind(i64::from(query.offset))
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| PlayHistoryError::unavailable())?;
        transaction
            .commit()
            .await
            .map_err(|_| PlayHistoryError::unavailable())?;
        Ok(PlayHistoryPage {
            items: rows
                .iter()
                .map(history_item_from_row)
                .collect::<Result<Vec<_>, _>>()?,
            total,
        })
    }

    async fn clear(&self) -> Result<PlayHistoryMutation, PlayHistoryError> {
        let affected = sqlx::query("DELETE FROM play_history")
            .execute(&self.pool)
            .await
            .map_err(|_| PlayHistoryError::unavailable())?
            .rows_affected();
        Ok(PlayHistoryMutation { affected })
    }
}

fn history_item_from_row(
    row: &sqlx::sqlite::SqliteRow,
) -> Result<PlayHistoryItem, PlayHistoryError> {
    Ok(PlayHistoryItem {
        album: row
            .try_get("album")
            .map_err(|_| PlayHistoryError::unavailable())?,
        artist: row
            .try_get("artist")
            .map_err(|_| PlayHistoryError::unavailable())?,
        availability: row
            .try_get("availability")
            .map_err(|_| PlayHistoryError::unavailable())?,
        completed: row
            .try_get::<i64, _>("completed")
            .map_err(|_| PlayHistoryError::unavailable())?
            == 1,
        duration_ms: as_u64(row, "duration_ms")?,
        ended_at: row
            .try_get("ended_at")
            .map_err(|_| PlayHistoryError::unavailable())?,
        id: row
            .try_get("id")
            .map_err(|_| PlayHistoryError::unavailable())?,
        listened_ms: as_u64(row, "listened_ms")?,
        position_ms: as_u64(row, "position_ms")?,
        source_kind: row
            .try_get("source_kind")
            .map_err(|_| PlayHistoryError::unavailable())?,
        started_at: row
            .try_get("started_at")
            .map_err(|_| PlayHistoryError::unavailable())?,
        title: row
            .try_get("title")
            .map_err(|_| PlayHistoryError::unavailable())?,
        track_id: row
            .try_get("track_id")
            .map_err(|_| PlayHistoryError::unavailable())?,
    })
}

fn as_i64(value: u64) -> Result<i64, PlayHistoryError> {
    i64::try_from(value).map_err(|_| PlayHistoryError::unavailable())
}

fn as_u64(row: &sqlx::sqlite::SqliteRow, column: &str) -> Result<u64, PlayHistoryError> {
    let value = row
        .try_get::<i64, _>(column)
        .map_err(|_| PlayHistoryError::unavailable())?;
    u64::try_from(value).map_err(|_| PlayHistoryError::unavailable())
}

fn is_complete(listened_ms: u64, duration_ms: u64) -> bool {
    duration_ms > 0 && listened_ms >= duration_ms.div_ceil(2).min(COMPLETION_CAP_MS)
}

struct ActiveListening {
    duration_ms: u64,
    instance_key: String,
    listened_ms: u64,
    position_ms: u64,
    row_id: i64,
    track_id: String,
}

impl ActiveListening {
    fn observe(&mut self, sample: &ListeningSample) {
        if sample.instance_key != self.instance_key || sample.track_id != self.track_id {
            return;
        }
        let position_ms = sample.position_ms.min(sample.duration_ms);
        if sample.playing && position_ms >= self.position_ms {
            let delta = position_ms - self.position_ms;
            if delta <= MAX_FORWARD_DELTA_MS {
                self.listened_ms = self.listened_ms.saturating_add(delta);
            }
        }
        self.position_ms = position_ms;
        self.duration_ms = self.duration_ms.max(sample.duration_ms);
    }
}

pub(super) struct PlayHistoryService {
    active: Mutex<Option<ActiveListening>>,
    ready: OnceCell<Result<(), PlayHistoryError>>,
    repository: PlayHistoryRepository,
}

enum HistoryEvent {
    Started(ListeningSample),
    Observed(ListeningSample, bool),
    Finished(Option<ListeningSample>),
    Page(
        PlayHistoryQuery,
        oneshot::Sender<Result<PlayHistoryPage, PlayHistoryError>>,
    ),
    Clear(oneshot::Sender<Result<PlayHistoryMutation, PlayHistoryError>>),
}

#[derive(Clone)]
pub(super) struct PlayHistoryRecorder {
    sender: mpsc::Sender<HistoryEvent>,
}

impl PlayHistoryRecorder {
    pub(super) fn new(pool: SqlitePool) -> Self {
        let (sender, mut receiver) = mpsc::channel(MAX_PENDING_EVENTS);
        let service = PlayHistoryService::new(pool);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = receiver.recv().await {
                match event {
                    HistoryEvent::Started(sample) => {
                        let _ = service.started(sample).await;
                    }
                    HistoryEvent::Observed(sample, persist) => {
                        let _ = service.observe(sample, persist).await;
                    }
                    HistoryEvent::Finished(sample) => {
                        let _ = service.finish(sample).await;
                    }
                    HistoryEvent::Page(query, reply) => {
                        let _ = reply.send(service.page(query).await);
                    }
                    HistoryEvent::Clear(reply) => {
                        let _ = reply.send(service.clear().await);
                    }
                }
            }
        });
        Self { sender }
    }

    pub(super) fn started(&self, sample: ListeningSample) {
        let _ = self.sender.try_send(HistoryEvent::Started(sample));
    }

    pub(super) fn observe(&self, sample: ListeningSample, persist: bool) {
        let _ = self
            .sender
            .try_send(HistoryEvent::Observed(sample, persist));
    }

    pub(super) fn finish(&self, sample: Option<ListeningSample>) {
        let _ = self.sender.try_send(HistoryEvent::Finished(sample));
    }

    pub(super) async fn page(
        &self,
        query: PlayHistoryQuery,
    ) -> Result<PlayHistoryPage, PlayHistoryError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(HistoryEvent::Page(query, reply))
            .await
            .map_err(|_| PlayHistoryError::unavailable())?;
        response
            .await
            .map_err(|_| PlayHistoryError::unavailable())?
    }

    pub(super) async fn clear(&self) -> Result<PlayHistoryMutation, PlayHistoryError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(HistoryEvent::Clear(reply))
            .await
            .map_err(|_| PlayHistoryError::unavailable())?;
        response
            .await
            .map_err(|_| PlayHistoryError::unavailable())?
    }
}

impl PlayHistoryService {
    pub(super) fn new(pool: SqlitePool) -> Self {
        Self {
            active: Mutex::new(None),
            ready: OnceCell::new(),
            repository: PlayHistoryRepository::new(pool),
        }
    }

    async fn ensure_ready(&self) -> Result<(), PlayHistoryError> {
        self.ready
            .get_or_init(|| async { self.repository.recover_stale_open_row().await })
            .await
            .clone()
    }

    pub(super) async fn started(&self, sample: ListeningSample) -> Result<(), PlayHistoryError> {
        self.ensure_ready().await?;
        let mut active = self.active.lock().await;
        if active
            .as_ref()
            .is_some_and(|current| current.instance_key == sample.instance_key)
        {
            if let Some(current) = active.as_mut() {
                current.position_ms = sample.position_ms.min(sample.duration_ms);
                current.duration_ms = current.duration_ms.max(sample.duration_ms);
            }
            return Ok(());
        }
        if let Some(previous) = active.take() {
            self.repository.finish(&previous).await?;
        }
        let Some(row_id) = self
            .repository
            .start(&sample.track_id, sample.source)
            .await?
        else {
            return Ok(());
        };
        *active = Some(ActiveListening {
            duration_ms: sample.duration_ms,
            instance_key: sample.instance_key,
            listened_ms: 0,
            position_ms: sample.position_ms.min(sample.duration_ms),
            row_id,
            track_id: sample.track_id,
        });
        Ok(())
    }

    pub(super) async fn observe(
        &self,
        sample: ListeningSample,
        persist: bool,
    ) -> Result<(), PlayHistoryError> {
        self.ensure_ready().await?;
        let mut active = self.active.lock().await;
        let Some(current) = active.as_mut() else {
            return Ok(());
        };
        if current.instance_key != sample.instance_key {
            let previous = active.take().expect("active history row exists");
            self.repository.finish(&previous).await?;
            return Ok(());
        }
        current.observe(&sample);
        if persist {
            self.repository.checkpoint(current).await?;
        }
        Ok(())
    }

    pub(super) async fn finish(
        &self,
        sample: Option<ListeningSample>,
    ) -> Result<(), PlayHistoryError> {
        self.ensure_ready().await?;
        let mut active = self.active.lock().await;
        let Some(mut current) = active.take() else {
            return Ok(());
        };
        if let Some(sample) = sample.as_ref() {
            current.observe(sample);
        }
        self.repository.finish(&current).await
    }

    pub(super) async fn page(
        &self,
        query: PlayHistoryQuery,
    ) -> Result<PlayHistoryPage, PlayHistoryError> {
        self.ensure_ready().await?;
        self.repository.page(query).await
    }

    pub(super) async fn clear(&self) -> Result<PlayHistoryMutation, PlayHistoryError> {
        self.ensure_ready().await?;
        *self.active.lock().await = None;
        self.repository.clear().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn service() -> (SqlitePool, PlayHistoryService) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open history fixture");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate history fixture");
        sqlx::query(
            "INSERT INTO songs (
               id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
               trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
               favorRating, dateAdded, visualsPath
             ) VALUES (
               'track', '/music/track.flac', 'track.flac', 'Track', 'Album', 'Artist', '', 0, 0,
               '2026', '', 1, 1, 'flac', '0:02:00.000', '44100', 1, 0, 0,
               '2026-08-27', ''
             )",
        )
        .execute(&pool)
        .await
        .expect("insert history fixture song");
        (pool.clone(), PlayHistoryService::new(pool))
    }

    fn sample(position_ms: u64, duration_ms: u64, playing: bool) -> ListeningSample {
        ListeningSample {
            duration_ms,
            instance_key: "context:0:track".to_owned(),
            playing,
            position_ms,
            source: HistorySource::Context,
            track_id: "track".to_owned(),
        }
    }

    #[test]
    fn actual_start_is_idempotent_and_forward_deltas_ignore_seeks() {
        tauri::async_runtime::block_on(async {
            let (pool, service) = service().await;
            service
                .started(sample(0, 120_000, true))
                .await
                .expect("start history row");
            service
                .started(sample(0, 120_000, true))
                .await
                .expect("resume same history row");
            for position in [1_000, 2_000, 100_000, 101_000] {
                service
                    .observe(sample(position, 120_000, true), true)
                    .await
                    .expect("observe history position");
            }
            service
                .finish(Some(sample(101_000, 120_000, false)))
                .await
                .expect("finish history row");

            let row: (i64, i64, i64) =
                sqlx::query_as("SELECT COUNT(*), listened_ms, completed FROM play_history")
                    .fetch_one(&pool)
                    .await
                    .expect("read history progress");
            assert_eq!(row, (1, 3_000, 0));
        });
    }

    #[test]
    fn completion_uses_half_duration_with_a_four_minute_cap() {
        assert!(!is_complete(59_999, 120_000));
        assert!(is_complete(60_000, 120_000));
        assert!(!is_complete(239_999, 600_000));
        assert!(is_complete(240_000, 600_000));
        assert!(!is_complete(10_000, 0));
    }

    #[test]
    fn stale_rows_recover_pages_keep_snapshots_and_clear_explicitly() {
        tauri::async_runtime::block_on(async {
            let (pool, service) = service().await;
            sqlx::query(
                "INSERT INTO play_history (
                   track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind,
                   listened_ms, position_ms, duration_ms
                 ) VALUES ('track', 'Snapshot', 'Snapshot artist', 'Snapshot album', 'queue',
                           60_000, 60_000, 120_000)",
            )
            .execute(&pool)
            .await
            .expect("insert stale history row");
            service.ensure_ready().await.expect("recover stale row");
            sqlx::query("DELETE FROM songs WHERE id = 'track'")
                .execute(&pool)
                .await
                .expect("delete catalog track");

            let page = service
                .page(PlayHistoryQuery::default())
                .await
                .expect("page recovered history");
            assert_eq!(page.total, 1);
            assert_eq!(page.items[0].title, "Snapshot");
            assert_eq!(page.items[0].availability, "missing");
            assert_eq!(page.items[0].source_kind, "queue");
            assert!(page.items[0].completed);
            assert!(page.items[0].ended_at.is_some());
            assert_eq!(
                service
                    .page(PlayHistoryQuery {
                        limit: 0,
                        offset: 0,
                    })
                    .await
                    .expect_err("reject empty history page")
                    .code,
                "invalid_query"
            );
            assert_eq!(service.clear().await.expect("clear history").affected, 1);
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM play_history")
                    .fetch_one(&pool)
                    .await
                    .expect("count cleared rows"),
                0
            );
        });
    }

    #[test]
    fn retention_keeps_only_the_newest_bounded_rows() {
        tauri::async_runtime::block_on(async {
            let (pool, service) = service().await;
            sqlx::query(
                "WITH RECURSIVE rows(value) AS (
                   SELECT 1 UNION ALL SELECT value + 1 FROM rows WHERE value < 10005
                 )
                 INSERT INTO play_history (
                   track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind,
                   ended_at, open_slot
                 )
                 SELECT 'track', 'Track', 'Artist', 'Album', 'context',
                        STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
                 FROM rows",
            )
            .execute(&pool)
            .await
            .expect("insert retention fixture");
            service.repository.prune().await.expect("prune history");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM play_history")
                    .fetch_one(&pool)
                    .await
                    .expect("count retained history"),
                MAX_HISTORY_ROWS
            );
        });
    }
}

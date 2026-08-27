use super::collections::BuiltInCollectionItem;
use super::playlists::{
    generated_playlist_id, normalize_name, playlist_conflict, summary_by_id, validate_playlist_id,
    PlaylistMutation, PlaylistSummary,
};
use super::query::{LibraryError, MAX_PAGE_SIZE};
use super::repository::{fts_expression, track_from_row};
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};

const CURRENT_RULE_VERSION: u8 = 1;
const MAX_RULES: usize = 32;
const MAX_RULE_JSON_BYTES: usize = 65_536;
const MAX_RULE_TEXT_CHARACTERS: usize = 1_024;
const MAX_RESULT_LIMIT: u32 = 10_000;
const MAX_PAGE_OFFSET: u32 = 100_000;

const HISTORY_CTE: &str = "WITH history_metrics AS (
       SELECT track_id, SUM(completed) AS play_count, SUM(listened_ms) AS listened_ms,
              MAX(started_at) AS last_played_at
       FROM play_history
       GROUP BY track_id
     ) ";

const TRACK_SELECT: &str = "SELECT songs.id, songs.path, songs.file, songs.title, songs.album,
       songs.artist, songs.genre, songs.bpm, songs.compilation, songs.date, songs.encoder,
       songs.trackTotal, songs.trackNumber, songs.codec, songs.duration, songs.sampleRate,
       songs.side, songs.startTime, songs.favorRating, songs.dateAdded, songs.visualsPath,
       songs.availability, COALESCE(history_metrics.play_count, 0) AS play_count,
       COALESCE(history_metrics.listened_ms, 0) AS listened_ms,
       history_metrics.last_played_at
     FROM songs
     LEFT JOIN history_metrics ON history_metrics.track_id = songs.id";

const DURATION_MS: &str =
    "(CAST(SUBSTR(songs.duration, 1, INSTR(songs.duration, ':') - 1) AS INTEGER) * 3600000
       + CAST(SUBSTR(
           songs.duration,
           INSTR(songs.duration, ':') + 1,
           INSTR(SUBSTR(songs.duration, INSTR(songs.duration, ':') + 1), ':') - 1
         ) AS INTEGER) * 60000
       + CAST(SUBSTR(
           songs.duration,
           INSTR(songs.duration, ':')
             + INSTR(SUBSTR(songs.duration, INSTR(songs.duration, ':') + 1), ':') + 1
         ) AS REAL) * 1000)";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartMatchMode {
    All,
    Any,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartTextOperator {
    Is,
    IsNot,
    Contains,
    DoesNotContain,
    StartsWith,
    EndsWith,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartNumberOperator {
    Equal,
    NotEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartDateOperator {
    Before,
    OnOrBefore,
    After,
    OnOrAfter,
    IsSet,
    IsNotSet,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartEqualityOperator {
    Is,
    IsNot,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartAvailability {
    Available,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "field", rename_all = "snake_case")]
pub enum SmartRule {
    Text {
        value: String,
    },
    Artist {
        operator: SmartTextOperator,
        value: String,
    },
    Album {
        operator: SmartTextOperator,
        value: String,
    },
    Genre {
        operator: SmartTextOperator,
        value: String,
    },
    Codec {
        operator: SmartTextOperator,
        value: String,
    },
    Year {
        operator: SmartNumberOperator,
        value: i64,
    },
    Favorite {
        operator: SmartNumberOperator,
        value: i64,
    },
    DateAdded {
        operator: SmartDateOperator,
        value: Option<String>,
    },
    LastPlayed {
        operator: SmartDateOperator,
        value: Option<String>,
    },
    PlayCount {
        operator: SmartNumberOperator,
        value: i64,
    },
    DurationMs {
        operator: SmartNumberOperator,
        value: i64,
    },
    SampleRate {
        operator: SmartNumberOperator,
        value: i64,
    },
    Availability {
        operator: SmartEqualityOperator,
        value: SmartAvailability,
    },
    Root {
        operator: SmartEqualityOperator,
        value: i64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartPlaylistSort {
    Default,
    Title,
    Artist,
    Album,
    Year,
    DateAdded,
    Favorite,
    LastPlayed,
    PlayCount,
    Duration,
    SampleRate,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartSortDirection {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylistDefinition {
    pub version: u8,
    pub match_mode: SmartMatchMode,
    pub rules: Vec<SmartRule>,
    pub result_limit: u32,
    pub sort: SmartPlaylistSort,
    pub direction: SmartSortDirection,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylist {
    pub definition: SmartPlaylistDefinition,
    pub summary: PlaylistSummary,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SmartPlaylistQuery {
    pub limit: u32,
    pub offset: u32,
}

impl Default for SmartPlaylistQuery {
    fn default() -> Self {
        Self {
            limit: 50,
            offset: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylistItem {
    pub availability: String,
    #[serde(flatten)]
    pub collection: BuiltInCollectionItem,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylistPage {
    pub items: Vec<SmartPlaylistItem>,
    pub revision: String,
    pub total: i64,
}

#[derive(Debug)]
struct NormalizedPage {
    limit: u32,
    offset: u32,
}

impl SmartPlaylistQuery {
    fn normalize(self) -> Result<NormalizedPage, LibraryError> {
        if self.limit == 0 {
            return Err(LibraryError::invalid_query(
                "Smart playlist page size must be at least one.",
            ));
        }
        if self.offset > MAX_PAGE_OFFSET {
            return Err(LibraryError::invalid_query(
                "Smart playlist page offset is outside the supported range.",
            ));
        }
        Ok(NormalizedPage {
            limit: self.limit.min(MAX_PAGE_SIZE),
            offset: self.offset,
        })
    }
}

impl SmartPlaylistDefinition {
    fn canonical_json(&self) -> Result<String, LibraryError> {
        self.validate()?;
        let json = serde_json::to_string(self).map_err(|_| {
            LibraryError::invalid_query("Smart playlist rules could not be encoded.")
        })?;
        if json.len() > MAX_RULE_JSON_BYTES {
            return Err(LibraryError::invalid_query(
                "Smart playlist rules exceed the supported size.",
            ));
        }
        Ok(json)
    }

    fn validate(&self) -> Result<(), LibraryError> {
        if self.version != CURRENT_RULE_VERSION {
            return Err(LibraryError::invalid_query(
                "Smart playlist rule version is not supported.",
            ));
        }
        if self.rules.is_empty() || self.rules.len() > MAX_RULES {
            return Err(LibraryError::invalid_query(
                "Smart playlists require between one and 32 rules.",
            ));
        }
        if self.result_limit == 0 || self.result_limit > MAX_RESULT_LIMIT {
            return Err(LibraryError::invalid_query(
                "Smart playlist result limit must be between one and 10,000.",
            ));
        }
        for rule in &self.rules {
            validate_rule(rule)?;
        }
        Ok(())
    }
}

fn validate_text(value: &str) -> Result<(), LibraryError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > MAX_RULE_TEXT_CHARACTERS
        || value.chars().any(char::is_control)
    {
        return Err(LibraryError::invalid_query(
            "Smart playlist text values must be present and bounded.",
        ));
    }
    Ok(())
}

fn validate_date(operator: SmartDateOperator, value: &Option<String>) -> Result<(), LibraryError> {
    match operator {
        SmartDateOperator::IsSet | SmartDateOperator::IsNotSet if value.is_none() => Ok(()),
        SmartDateOperator::Before
        | SmartDateOperator::OnOrBefore
        | SmartDateOperator::After
        | SmartDateOperator::OnOrAfter => {
            let value = value.as_deref().unwrap_or_default();
            if is_bounded_iso_date(value) {
                Ok(())
            } else {
                Err(LibraryError::invalid_query(
                    "Smart playlist dates must use an ISO date or timestamp.",
                ))
            }
        }
        _ => Err(LibraryError::invalid_query(
            "Smart playlist date operators and values do not match.",
        )),
    }
}

fn is_bounded_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !(bytes.len() == 10 || (20..=35).contains(&bytes.len()))
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || !bytes[..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..7].iter().all(u8::is_ascii_digit)
        || !bytes[8..10].iter().all(u8::is_ascii_digit)
    {
        return false;
    }
    let year = value[..4].parse::<u16>().unwrap_or_default();
    let month = value[5..7].parse::<u8>().unwrap_or_default();
    let day = value[8..10].parse::<u8>().unwrap_or_default();
    if year == 0 || !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return false;
    }
    bytes.len() == 10
        || (bytes[10] == b'T'
            && bytes[11..].iter().all(|byte| {
                byte.is_ascii_digit() || matches!(byte, b'-' | b'+' | b':' | b'.' | b'Z')
            }))
}

fn days_in_month(year: u16, month: u8) -> u8 {
    match month {
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => 31,
    }
}

fn validate_rule(rule: &SmartRule) -> Result<(), LibraryError> {
    match rule {
        SmartRule::Text { value } => {
            validate_text(value)?;
            if fts_expression(value).is_none() {
                return Err(LibraryError::invalid_query(
                    "Smart playlist search text must contain a searchable character.",
                ));
            }
        }
        SmartRule::Artist { value, .. }
        | SmartRule::Album { value, .. }
        | SmartRule::Genre { value, .. }
        | SmartRule::Codec { value, .. } => validate_text(value)?,
        SmartRule::Year { value, .. } if !(1..=9_999).contains(value) => {
            return Err(LibraryError::invalid_query(
                "Smart playlist years must be between one and 9999.",
            ));
        }
        SmartRule::Favorite { value, .. } if !(0..=2).contains(value) => {
            return Err(LibraryError::invalid_query(
                "Smart playlist favorite ratings must be between zero and two.",
            ));
        }
        SmartRule::DateAdded {
            operator, value, ..
        }
        | SmartRule::LastPlayed {
            operator, value, ..
        } => validate_date(*operator, value)?,
        SmartRule::PlayCount { value, .. } if !(0..=1_000_000).contains(value) => {
            return Err(LibraryError::invalid_query(
                "Smart playlist play counts are outside the supported range.",
            ));
        }
        SmartRule::DurationMs { value, .. } if !(0..=604_800_000).contains(value) => {
            return Err(LibraryError::invalid_query(
                "Smart playlist durations are outside the supported range.",
            ));
        }
        SmartRule::SampleRate { value, .. } if !(1..=1_000_000).contains(value) => {
            return Err(LibraryError::invalid_query(
                "Smart playlist sample rates are outside the supported range.",
            ));
        }
        SmartRule::Root { value, .. } if *value < 0 => {
            return Err(LibraryError::invalid_query(
                "Smart playlist library root identifiers cannot be negative.",
            ));
        }
        _ => {}
    }
    Ok(())
}

fn stored_definition(version: i64, json: &str) -> Result<SmartPlaylistDefinition, LibraryError> {
    if version != i64::from(CURRENT_RULE_VERSION) || json.len() > MAX_RULE_JSON_BYTES {
        return Err(LibraryError::database());
    }
    let definition: SmartPlaylistDefinition =
        serde_json::from_str(json).map_err(|_| LibraryError::database())?;
    definition
        .validate()
        .map_err(|_| LibraryError::database())?;
    if definition.version != version as u8 {
        return Err(LibraryError::database());
    }
    Ok(definition)
}

pub(crate) async fn create_smart_playlist(
    pool: &SqlitePool,
    name: String,
    definition: SmartPlaylistDefinition,
) -> Result<SmartPlaylist, LibraryError> {
    let name = normalize_name(&name)?;
    let rule_json = definition.canonical_json()?;
    let id = generated_playlist_id()?;
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    sqlx::query("INSERT INTO playlists (id, name, name_key, kind) VALUES (?, ?, ?, 'smart')")
        .bind(&id)
        .bind(name.display)
        .bind(name.key)
        .execute(&mut *transaction)
        .await
        .map_err(playlist_conflict)?;
    sqlx::query(
        "INSERT INTO smart_playlist_rules (playlist_id, version, rule_json) VALUES (?, ?, ?)",
    )
    .bind(&id)
    .bind(i64::from(definition.version))
    .bind(rule_json)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?;
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    get_smart_playlist(pool, id).await
}

pub(crate) async fn get_smart_playlist(
    pool: &SqlitePool,
    playlist_id: String,
) -> Result<SmartPlaylist, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    let row = sqlx::query(
        "SELECT smart_playlist_rules.version, smart_playlist_rules.rule_json
         FROM smart_playlist_rules
         JOIN playlists ON playlists.id = smart_playlist_rules.playlist_id
         WHERE playlists.id = ? AND playlists.kind = 'smart'",
    )
    .bind(&playlist_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| LibraryError::database())?
    .ok_or_else(LibraryError::playlist_not_found)?;
    let version = row
        .try_get("version")
        .map_err(|_| LibraryError::database())?;
    let json: String = row
        .try_get("rule_json")
        .map_err(|_| LibraryError::database())?;
    Ok(SmartPlaylist {
        definition: stored_definition(version, &json)?,
        summary: summary_by_id(pool, &playlist_id).await?,
    })
}

pub(crate) async fn update_smart_playlist(
    pool: &SqlitePool,
    playlist_id: String,
    name: String,
    definition: SmartPlaylistDefinition,
) -> Result<SmartPlaylist, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    let name = normalize_name(&name)?;
    let rule_json = definition.canonical_json()?;
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    let playlist = sqlx::query(
        "UPDATE playlists
         SET name = ?, name_key = ?, updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND kind = 'smart'",
    )
    .bind(name.display)
    .bind(name.key)
    .bind(&playlist_id)
    .execute(&mut *transaction)
    .await
    .map_err(playlist_conflict)?;
    if playlist.rows_affected() != 1 {
        return Err(LibraryError::playlist_not_found());
    }
    let rules = sqlx::query(
        "UPDATE smart_playlist_rules
         SET version = ?, rule_json = ?, updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE playlist_id = ?",
    )
    .bind(i64::from(definition.version))
    .bind(rule_json)
    .bind(&playlist_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?;
    if rules.rows_affected() != 1 {
        return Err(LibraryError::database());
    }
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    get_smart_playlist(pool, playlist_id).await
}

pub(crate) async fn delete_smart_playlist(
    pool: &SqlitePool,
    playlist_id: String,
) -> Result<PlaylistMutation, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    let result = sqlx::query("DELETE FROM playlists WHERE id = ? AND kind = 'smart'")
        .bind(playlist_id)
        .execute(pool)
        .await
        .map_err(|_| LibraryError::database())?;
    if result.rows_affected() != 1 {
        return Err(LibraryError::playlist_not_found());
    }
    Ok(PlaylistMutation { affected: 1 })
}

pub(crate) async fn query_smart_playlist(
    pool: &SqlitePool,
    playlist_id: String,
    query: SmartPlaylistQuery,
) -> Result<SmartPlaylistPage, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    let query = query.normalize()?;
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    let row = sqlx::query(
        "SELECT smart_playlist_rules.version, smart_playlist_rules.rule_json
         FROM smart_playlist_rules
         JOIN playlists ON playlists.id = smart_playlist_rules.playlist_id
         WHERE playlists.id = ? AND playlists.kind = 'smart'",
    )
    .bind(&playlist_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?
    .ok_or_else(LibraryError::playlist_not_found)?;
    let version = row
        .try_get("version")
        .map_err(|_| LibraryError::database())?;
    let rule_json: String = row
        .try_get("rule_json")
        .map_err(|_| LibraryError::database())?;
    let definition = stored_definition(version, &rule_json)?;
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

    let mut count = QueryBuilder::<Sqlite>::new(HISTORY_CTE);
    count.push("SELECT COUNT(*) FROM (SELECT 1 FROM songs LEFT JOIN history_metrics ON history_metrics.track_id = songs.id");
    push_rules(&mut count, &definition);
    count
        .push(" LIMIT ")
        .push_bind(i64::from(definition.result_limit))
        .push(") AS smart_matches");
    let total: i64 = count
        .build_query_scalar()
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;

    let remaining = definition.result_limit.saturating_sub(query.offset);
    let page_limit = query.limit.min(remaining);
    let rows = if page_limit == 0 {
        Vec::new()
    } else {
        let mut page = QueryBuilder::<Sqlite>::new(HISTORY_CTE);
        page.push(TRACK_SELECT);
        push_rules(&mut page, &definition);
        push_order(&mut page, definition.sort, definition.direction);
        page.push(" LIMIT ")
            .push_bind(i64::from(page_limit))
            .push(" OFFSET ")
            .push_bind(i64::from(query.offset));
        page.build()
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| LibraryError::database())?
    };
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;

    Ok(SmartPlaylistPage {
        items: rows
            .iter()
            .map(smart_item_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        revision: format!(
            "{catalog_revision}:{last_history_id}:{completed_plays}:{:x}",
            md5::compute(rule_json)
        ),
        total,
    })
}

fn smart_item_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<SmartPlaylistItem, LibraryError> {
    let play_count = row
        .try_get::<i64, _>("play_count")
        .map_err(|_| LibraryError::database())?;
    let listened_ms = row
        .try_get::<i64, _>("listened_ms")
        .map_err(|_| LibraryError::database())?;
    Ok(SmartPlaylistItem {
        availability: row
            .try_get("availability")
            .map_err(|_| LibraryError::database())?,
        collection: BuiltInCollectionItem {
            last_played_at: row
                .try_get("last_played_at")
                .map_err(|_| LibraryError::database())?,
            listened_ms: u64::try_from(listened_ms).map_err(|_| LibraryError::database())?,
            play_count: u64::try_from(play_count).map_err(|_| LibraryError::database())?,
            track: track_from_row(row)?,
        },
    })
}

fn push_rules(builder: &mut QueryBuilder<'_, Sqlite>, definition: &SmartPlaylistDefinition) {
    builder.push(" WHERE (");
    let join = match definition.match_mode {
        SmartMatchMode::All => " AND ",
        SmartMatchMode::Any => " OR ",
    };
    for (index, rule) in definition.rules.iter().enumerate() {
        if index > 0 {
            builder.push(join);
        }
        builder.push("(");
        push_rule(builder, rule);
        builder.push(")");
    }
    builder.push(")");
}

fn push_rule(builder: &mut QueryBuilder<'_, Sqlite>, rule: &SmartRule) {
    match rule {
        SmartRule::Text { value } => {
            builder
                .push("songs.id IN (SELECT song_id FROM songs_fts WHERE songs_fts MATCH ")
                .push_bind(fts_expression(value).unwrap_or_default())
                .push(")");
        }
        SmartRule::Artist { operator, value } => {
            push_text_rule(builder, "songs.artist", *operator, value)
        }
        SmartRule::Album { operator, value } => {
            push_text_rule(builder, "songs.album", *operator, value)
        }
        SmartRule::Genre { operator, value } => {
            push_text_rule(builder, "songs.genre", *operator, value)
        }
        SmartRule::Codec { operator, value } => {
            push_text_rule(builder, "songs.codec", *operator, value)
        }
        SmartRule::Year { operator, value } => {
            push_number_rule(builder, "CAST(songs.date AS INTEGER)", *operator, *value)
        }
        SmartRule::Favorite { operator, value } => {
            push_number_rule(builder, "songs.favorRating", *operator, *value)
        }
        SmartRule::DateAdded { operator, value } => {
            push_date_rule(builder, "songs.dateAdded", *operator, value)
        }
        SmartRule::LastPlayed { operator, value } => {
            push_date_rule(builder, "history_metrics.last_played_at", *operator, value)
        }
        SmartRule::PlayCount { operator, value } => push_number_rule(
            builder,
            "COALESCE(history_metrics.play_count, 0)",
            *operator,
            *value,
        ),
        SmartRule::DurationMs { operator, value } => {
            push_number_rule(builder, DURATION_MS, *operator, *value)
        }
        SmartRule::SampleRate { operator, value } => push_number_rule(
            builder,
            "CAST(songs.sampleRate AS INTEGER)",
            *operator,
            *value,
        ),
        SmartRule::Availability { operator, value } => {
            let value = match value {
                SmartAvailability::Available => "available",
                SmartAvailability::Unavailable => "unavailable",
            };
            builder
                .push("songs.availability ")
                .push(equality_sql(*operator))
                .push_bind(value);
        }
        SmartRule::Root { operator, value } if *value == 0 => {
            builder.push("songs.root_id IS ");
            if *operator == SmartEqualityOperator::IsNot {
                builder.push("NOT ");
            }
            builder.push("NULL");
        }
        SmartRule::Root { operator, value } => {
            builder
                .push("songs.root_id ")
                .push(equality_sql(*operator))
                .push_bind(*value);
        }
    }
}

fn equality_sql(operator: SmartEqualityOperator) -> &'static str {
    match operator {
        SmartEqualityOperator::Is => "= ",
        SmartEqualityOperator::IsNot => "!= ",
    }
}

fn push_text_rule(
    builder: &mut QueryBuilder<'_, Sqlite>,
    expression: &'static str,
    operator: SmartTextOperator,
    value: &str,
) {
    builder.push(expression).push(" COLLATE NOCASE ");
    match operator {
        SmartTextOperator::Is => {
            builder.push("= ").push_bind(value.trim().to_owned());
        }
        SmartTextOperator::IsNot => {
            builder.push("!= ").push_bind(value.trim().to_owned());
        }
        SmartTextOperator::Contains => {
            builder
                .push("LIKE ")
                .push_bind(format!("%{}%", escape_like(value.trim())))
                .push(" ESCAPE '\\'");
        }
        SmartTextOperator::DoesNotContain => {
            builder
                .push("NOT LIKE ")
                .push_bind(format!("%{}%", escape_like(value.trim())))
                .push(" ESCAPE '\\'");
        }
        SmartTextOperator::StartsWith => {
            builder
                .push("LIKE ")
                .push_bind(format!("{}%", escape_like(value.trim())))
                .push(" ESCAPE '\\'");
        }
        SmartTextOperator::EndsWith => {
            builder
                .push("LIKE ")
                .push_bind(format!("%{}", escape_like(value.trim())))
                .push(" ESCAPE '\\'");
        }
    }
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn push_number_rule(
    builder: &mut QueryBuilder<'_, Sqlite>,
    expression: &'static str,
    operator: SmartNumberOperator,
    value: i64,
) {
    let comparison = match operator {
        SmartNumberOperator::Equal => " = ",
        SmartNumberOperator::NotEqual => " != ",
        SmartNumberOperator::GreaterThan => " > ",
        SmartNumberOperator::GreaterThanOrEqual => " >= ",
        SmartNumberOperator::LessThan => " < ",
        SmartNumberOperator::LessThanOrEqual => " <= ",
    };
    builder.push(expression).push(comparison).push_bind(value);
}

fn push_date_rule(
    builder: &mut QueryBuilder<'_, Sqlite>,
    expression: &'static str,
    operator: SmartDateOperator,
    value: &Option<String>,
) {
    match operator {
        SmartDateOperator::IsSet => {
            builder
                .push(expression)
                .push(" IS NOT NULL AND ")
                .push(expression)
                .push(" != ''");
        }
        SmartDateOperator::IsNotSet => {
            builder
                .push(expression)
                .push(" IS NULL OR ")
                .push(expression)
                .push(" = ''");
        }
        SmartDateOperator::Before => {
            push_date_expression(builder, expression, value);
            builder
                .push(" < ")
                .push_bind(value.clone().unwrap_or_default());
        }
        SmartDateOperator::OnOrBefore => {
            push_date_expression(builder, expression, value);
            builder
                .push(" <= ")
                .push_bind(value.clone().unwrap_or_default());
        }
        SmartDateOperator::After => {
            push_date_expression(builder, expression, value);
            builder
                .push(" > ")
                .push_bind(value.clone().unwrap_or_default());
        }
        SmartDateOperator::OnOrAfter => {
            push_date_expression(builder, expression, value);
            builder
                .push(" >= ")
                .push_bind(value.clone().unwrap_or_default());
        }
    }
}

fn push_date_expression(
    builder: &mut QueryBuilder<'_, Sqlite>,
    expression: &'static str,
    value: &Option<String>,
) {
    if value.as_deref().is_some_and(|value| value.len() == 10) {
        builder.push("SUBSTR(").push(expression).push(", 1, 10)");
    } else {
        builder.push(expression);
    }
}

fn push_order(
    builder: &mut QueryBuilder<'_, Sqlite>,
    sort: SmartPlaylistSort,
    direction: SmartSortDirection,
) {
    let order = match direction {
        SmartSortDirection::Asc => " ASC",
        SmartSortDirection::Desc => " DESC",
    };
    builder.push(" ORDER BY ");
    let expressions: &[&str] = match sort {
        SmartPlaylistSort::Default => &[
            "songs.artist COLLATE NOCASE",
            "songs.album COLLATE NOCASE",
            "songs.side",
            "songs.trackNumber",
            "songs.title COLLATE NOCASE",
        ],
        SmartPlaylistSort::Title => &["songs.title COLLATE NOCASE"],
        SmartPlaylistSort::Artist => &["songs.artist COLLATE NOCASE", "songs.album COLLATE NOCASE"],
        SmartPlaylistSort::Album => &["songs.album COLLATE NOCASE", "songs.artist COLLATE NOCASE"],
        SmartPlaylistSort::Year => &["CAST(songs.date AS INTEGER)"],
        SmartPlaylistSort::DateAdded => &["songs.dateAdded"],
        SmartPlaylistSort::Favorite => &["songs.favorRating"],
        SmartPlaylistSort::LastPlayed => &["COALESCE(history_metrics.last_played_at, '')"],
        SmartPlaylistSort::PlayCount => &["COALESCE(history_metrics.play_count, 0)"],
        SmartPlaylistSort::Duration => &[DURATION_MS],
        SmartPlaylistSort::SampleRate => &["CAST(songs.sampleRate AS INTEGER)"],
    };
    for (index, expression) in expressions.iter().enumerate() {
        if index > 0 {
            builder.push(", ");
        }
        builder.push(*expression).push(order);
    }
    builder.push(", songs.id COLLATE BINARY").push(order);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::NATIVE_MIGRATOR;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn fixture() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open smart playlist fixture");
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .expect("enable foreign keys");
        NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate smart playlist fixture");
        let root_id: i64 = sqlx::query_scalar(
            "INSERT INTO library_roots (path, canonical_path) VALUES ('/Music', '/Music') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .expect("insert library root");

        for song in [
            (
                "alpha",
                "Aurora",
                "North 100%",
                "Electronic",
                "flac",
                "1997",
                2_i64,
                "2026-01-03T00:00:00.000Z",
                "0:05:00.000",
                "44100",
                "available",
                Some(root_id),
            ),
            (
                "beta",
                "Borealis",
                "South",
                "Rock",
                "mp3",
                "2020",
                0_i64,
                "2025-01-03T00:00:00.000Z",
                "0:03:00.000",
                "48000",
                "available",
                Some(root_id),
            ),
            (
                "gamma",
                "Cinder",
                "West",
                "Jazz",
                "aac",
                "1980",
                1_i64,
                "2024-01-03T00:00:00.000Z",
                "0:01:30.000",
                "96000",
                "unavailable",
                None,
            ),
        ] {
            sqlx::query(
                "INSERT INTO songs (
                   id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
                   trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
                   favorRating, dateAdded, visualsPath, root_id, normalized_path, availability
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, 120, 0, ?, '', 1, 1, ?, ?, ?, 1, 0, ?, ?, '', ?, ?, ?)",
            )
            .bind(song.0)
            .bind(format!("/Music/{}.flac", song.0))
            .bind(format!("{}.flac", song.0))
            .bind(format!("{} light", song.0))
            .bind(song.2)
            .bind(song.1)
            .bind(song.3)
            .bind(song.5)
            .bind(song.4)
            .bind(song.8)
            .bind(song.9)
            .bind(song.6)
            .bind(song.7)
            .bind(song.11)
            .bind(format!("{}.flac", song.0))
            .bind(song.10)
            .execute(&pool)
            .await
            .expect("insert smart playlist track");
        }

        for (track_id, completed, started_at, listened_ms) in [
            ("alpha", 1_i64, "2026-08-25T10:00:00.000Z", 300_000_i64),
            ("alpha", 1_i64, "2026-08-26T10:00:00.000Z", 300_000_i64),
            ("beta", 0_i64, "2026-08-24T10:00:00.000Z", 30_000_i64),
        ] {
            sqlx::query(
                "INSERT INTO play_history (
                   track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind,
                   started_at, ended_at, listened_ms, completed, open_slot
                 ) VALUES (?, ?, '', '', 'context', ?, ?, ?, ?, NULL)",
            )
            .bind(track_id)
            .bind(track_id)
            .bind(started_at)
            .bind(started_at)
            .bind(listened_ms)
            .bind(completed)
            .execute(&pool)
            .await
            .expect("insert smart playlist history");
        }
        pool
    }

    fn available_definition(rules: Vec<SmartRule>) -> SmartPlaylistDefinition {
        SmartPlaylistDefinition {
            version: 1,
            match_mode: SmartMatchMode::All,
            rules,
            result_limit: 100,
            sort: SmartPlaylistSort::Default,
            direction: SmartSortDirection::Asc,
        }
    }

    async fn create_for_rules(
        pool: &SqlitePool,
        name: &str,
        definition: SmartPlaylistDefinition,
    ) -> SmartPlaylist {
        create_smart_playlist(pool, name.to_owned(), definition)
            .await
            .expect("create smart playlist")
    }

    async fn ids(pool: &SqlitePool, playlist_id: &str) -> Vec<String> {
        query_smart_playlist(
            pool,
            playlist_id.to_owned(),
            SmartPlaylistQuery {
                limit: 100,
                offset: 0,
            },
        )
        .await
        .expect("query smart playlist")
        .items
        .into_iter()
        .map(|item| item.collection.track.id)
        .collect()
    }

    #[test]
    fn lifecycle_is_atomic_kind_safe_and_cascading() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let manual = super::super::playlists::create_playlist(&pool, "Manual".to_owned())
                .await
                .expect("create manual playlist");
            let original = available_definition(vec![SmartRule::Availability {
                operator: SmartEqualityOperator::Is,
                value: SmartAvailability::Available,
            }]);
            let smart = create_for_rules(&pool, "Available", original.clone()).await;
            assert_eq!(smart.summary.kind, "smart");
            assert_eq!(smart.definition, original);
            assert_eq!(
                get_smart_playlist(&pool, smart.summary.id.clone())
                    .await
                    .unwrap(),
                smart
            );

            let updated_definition = available_definition(vec![SmartRule::Favorite {
                operator: SmartNumberOperator::GreaterThanOrEqual,
                value: 1,
            }]);
            let updated = update_smart_playlist(
                &pool,
                smart.summary.id.clone(),
                "Rated".to_owned(),
                updated_definition.clone(),
            )
            .await
            .expect("update smart playlist");
            assert_eq!(updated.summary.name, "Rated");
            assert_eq!(updated.definition, updated_definition);
            assert_eq!(
                super::super::playlists::rename_playlist(
                    &pool,
                    updated.summary.id.clone(),
                    "Wrong kind".to_owned(),
                )
                .await
                .unwrap_err()
                .code,
                "playlist_not_found"
            );
            assert_eq!(
                delete_smart_playlist(&pool, manual.id.clone())
                    .await
                    .unwrap_err()
                    .code,
                "playlist_not_found"
            );

            delete_smart_playlist(&pool, updated.summary.id.clone())
                .await
                .expect("delete smart playlist");
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM smart_playlist_rules WHERE playlist_id = ?"
                )
                .bind(updated.summary.id)
                .fetch_one(&pool)
                .await
                .expect("count deleted rules"),
                0
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM playlists WHERE id = ?")
                    .bind(manual.id)
                    .fetch_one(&pool)
                    .await
                    .expect("count preserved manual playlist"),
                1
            );
        });
    }

    #[test]
    fn all_rules_cover_metadata_history_duration_availability_and_root() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let smart = create_for_rules(
                &pool,
                "Precise",
                available_definition(vec![
                    SmartRule::Text {
                        value: "alpha light".to_owned(),
                    },
                    SmartRule::Artist {
                        operator: SmartTextOperator::StartsWith,
                        value: "Aur".to_owned(),
                    },
                    SmartRule::Album {
                        operator: SmartTextOperator::Contains,
                        value: "100%".to_owned(),
                    },
                    SmartRule::Genre {
                        operator: SmartTextOperator::Is,
                        value: "electronic".to_owned(),
                    },
                    SmartRule::Codec {
                        operator: SmartTextOperator::IsNot,
                        value: "mp3".to_owned(),
                    },
                    SmartRule::Year {
                        operator: SmartNumberOperator::GreaterThanOrEqual,
                        value: 1997,
                    },
                    SmartRule::Favorite {
                        operator: SmartNumberOperator::Equal,
                        value: 2,
                    },
                    SmartRule::DateAdded {
                        operator: SmartDateOperator::After,
                        value: Some("2026-01-01".to_owned()),
                    },
                    SmartRule::LastPlayed {
                        operator: SmartDateOperator::IsSet,
                        value: None,
                    },
                    SmartRule::PlayCount {
                        operator: SmartNumberOperator::GreaterThan,
                        value: 1,
                    },
                    SmartRule::DurationMs {
                        operator: SmartNumberOperator::GreaterThanOrEqual,
                        value: 300_000,
                    },
                    SmartRule::SampleRate {
                        operator: SmartNumberOperator::LessThanOrEqual,
                        value: 44_100,
                    },
                    SmartRule::Availability {
                        operator: SmartEqualityOperator::Is,
                        value: SmartAvailability::Available,
                    },
                    SmartRule::Root {
                        operator: SmartEqualityOperator::Is,
                        value: 1,
                    },
                ]),
            )
            .await;

            let page = query_smart_playlist(&pool, smart.summary.id, SmartPlaylistQuery::default())
                .await
                .expect("query precise smart playlist");
            assert_eq!(page.total, 1);
            assert_eq!(page.items[0].collection.track.id, "alpha");
            assert_eq!(page.items[0].collection.play_count, 2);
            assert_eq!(page.items[0].collection.listened_ms, 600_000);
            assert_eq!(page.items[0].availability, "available");
        });
    }

    #[test]
    fn any_rules_and_negative_operators_are_deterministic_and_injection_safe() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let mut definition = available_definition(vec![
                SmartRule::Artist {
                    operator: SmartTextOperator::Is,
                    value: "nobody' OR 1=1 --".to_owned(),
                },
                SmartRule::Album {
                    operator: SmartTextOperator::EndsWith,
                    value: "South".to_owned(),
                },
                SmartRule::LastPlayed {
                    operator: SmartDateOperator::IsNotSet,
                    value: None,
                },
            ]);
            definition.match_mode = SmartMatchMode::Any;
            definition.sort = SmartPlaylistSort::Title;
            let smart = create_for_rules(&pool, "Any", definition).await;
            assert_eq!(ids(&pool, &smart.summary.id).await, vec!["beta", "gamma"]);

            let escaped = create_for_rules(
                &pool,
                "Literal wildcard",
                available_definition(vec![SmartRule::Album {
                    operator: SmartTextOperator::Contains,
                    value: "100%".to_owned(),
                }]),
            )
            .await;
            assert_eq!(ids(&pool, &escaped.summary.id).await, vec!["alpha"]);

            let negative = create_for_rules(
                &pool,
                "Negative",
                available_definition(vec![
                    SmartRule::Artist {
                        operator: SmartTextOperator::DoesNotContain,
                        value: "Aur".to_owned(),
                    },
                    SmartRule::Year {
                        operator: SmartNumberOperator::NotEqual,
                        value: 1980,
                    },
                    SmartRule::Root {
                        operator: SmartEqualityOperator::IsNot,
                        value: 0,
                    },
                ]),
            )
            .await;
            assert_eq!(ids(&pool, &negative.summary.id).await, vec!["beta"]);
        });
    }

    #[test]
    fn remaining_operators_and_every_sort_are_bounded_and_repeatable() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let cases = [
                (
                    SmartRule::Year {
                        operator: SmartNumberOperator::LessThan,
                        value: 2000,
                    },
                    vec!["alpha", "gamma"],
                ),
                (
                    SmartRule::DateAdded {
                        operator: SmartDateOperator::Before,
                        value: Some("2025-01-01".to_owned()),
                    },
                    vec!["gamma"],
                ),
                (
                    SmartRule::DateAdded {
                        operator: SmartDateOperator::OnOrBefore,
                        value: Some("2025-01-03".to_owned()),
                    },
                    vec!["beta", "gamma"],
                ),
                (
                    SmartRule::LastPlayed {
                        operator: SmartDateOperator::OnOrAfter,
                        value: Some("2026-08-25T00:00:00.000Z".to_owned()),
                    },
                    vec!["alpha"],
                ),
                (
                    SmartRule::Availability {
                        operator: SmartEqualityOperator::IsNot,
                        value: SmartAvailability::Available,
                    },
                    vec!["gamma"],
                ),
            ];
            for (index, (rule, expected)) in cases.into_iter().enumerate() {
                let smart = create_for_rules(
                    &pool,
                    &format!("Operator {index}"),
                    available_definition(vec![rule]),
                )
                .await;
                assert_eq!(ids(&pool, &smart.summary.id).await, expected);
            }

            let mut definition = available_definition(vec![SmartRule::Year {
                operator: SmartNumberOperator::GreaterThan,
                value: 1,
            }]);
            let smart = create_for_rules(&pool, "Sorts", definition.clone()).await;
            for sort in [
                SmartPlaylistSort::Default,
                SmartPlaylistSort::Title,
                SmartPlaylistSort::Artist,
                SmartPlaylistSort::Album,
                SmartPlaylistSort::Year,
                SmartPlaylistSort::DateAdded,
                SmartPlaylistSort::Favorite,
                SmartPlaylistSort::LastPlayed,
                SmartPlaylistSort::PlayCount,
                SmartPlaylistSort::Duration,
                SmartPlaylistSort::SampleRate,
            ] {
                for direction in [SmartSortDirection::Asc, SmartSortDirection::Desc] {
                    definition.sort = sort;
                    definition.direction = direction;
                    update_smart_playlist(
                        &pool,
                        smart.summary.id.clone(),
                        "Sorts".to_owned(),
                        definition.clone(),
                    )
                    .await
                    .expect("update smart sort");
                    let first = ids(&pool, &smart.summary.id).await;
                    let repeated = ids(&pool, &smart.summary.id).await;
                    assert_eq!(first, repeated);
                    assert_eq!(first.len(), 3);
                }
            }
        });
    }

    #[test]
    fn validation_rejects_unknown_unbounded_and_mismatched_rules_before_storage() {
        let base = available_definition(vec![SmartRule::Availability {
            operator: SmartEqualityOperator::Is,
            value: SmartAvailability::Available,
        }]);
        for invalid in [
            SmartPlaylistDefinition {
                version: 2,
                ..base.clone()
            },
            SmartPlaylistDefinition {
                rules: Vec::new(),
                ..base.clone()
            },
            SmartPlaylistDefinition {
                rules: vec![base.rules[0].clone(); MAX_RULES + 1],
                ..base.clone()
            },
            SmartPlaylistDefinition {
                result_limit: 0,
                ..base.clone()
            },
            SmartPlaylistDefinition {
                rules: vec![SmartRule::Favorite {
                    operator: SmartNumberOperator::Equal,
                    value: 3,
                }],
                ..base.clone()
            },
            SmartPlaylistDefinition {
                rules: vec![SmartRule::DateAdded {
                    operator: SmartDateOperator::Before,
                    value: None,
                }],
                ..base.clone()
            },
            SmartPlaylistDefinition {
                rules: vec![SmartRule::DateAdded {
                    operator: SmartDateOperator::Before,
                    value: Some("2026-02-30".to_owned()),
                }],
                ..base.clone()
            },
            SmartPlaylistDefinition {
                rules: vec![SmartRule::LastPlayed {
                    operator: SmartDateOperator::IsSet,
                    value: Some("2026-01-01".to_owned()),
                }],
                ..base.clone()
            },
            SmartPlaylistDefinition {
                rules: vec![SmartRule::Root {
                    operator: SmartEqualityOperator::Is,
                    value: -1,
                }],
                ..base.clone()
            },
        ] {
            assert_eq!(invalid.canonical_json().unwrap_err().code, "invalid_query");
        }
        assert_eq!(
            SmartPlaylistQuery {
                limit: 0,
                offset: 0
            }
            .normalize()
            .unwrap_err()
            .code,
            "invalid_query"
        );
        assert_eq!(
            SmartPlaylistQuery {
                limit: 1,
                offset: MAX_PAGE_OFFSET + 1
            }
            .normalize()
            .unwrap_err()
            .code,
            "invalid_query"
        );
    }

    #[test]
    fn stored_rules_are_revalidated_before_reads_and_queries() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let smart = create_for_rules(
                &pool,
                "Corruption check",
                available_definition(vec![SmartRule::Availability {
                    operator: SmartEqualityOperator::Is,
                    value: SmartAvailability::Available,
                }]),
            )
            .await;
            sqlx::query("UPDATE smart_playlist_rules SET rule_json = '{}' WHERE playlist_id = ?")
                .bind(&smart.summary.id)
                .execute(&pool)
                .await
                .expect("inject invalid stored rule document");

            assert_eq!(
                get_smart_playlist(&pool, smart.summary.id.clone())
                    .await
                    .unwrap_err()
                    .code,
                "database_unavailable"
            );
            assert_eq!(
                query_smart_playlist(&pool, smart.summary.id, SmartPlaylistQuery::default(),)
                    .await
                    .unwrap_err()
                    .code,
                "database_unavailable"
            );
        });
    }

    #[test]
    fn result_caps_paging_and_rule_catalog_history_revisions_are_enforced() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let mut definition = available_definition(vec![SmartRule::Availability {
                operator: SmartEqualityOperator::Is,
                value: SmartAvailability::Available,
            }]);
            definition.result_limit = 1;
            definition.sort = SmartPlaylistSort::PlayCount;
            definition.direction = SmartSortDirection::Desc;
            let smart = create_for_rules(&pool, "Capped", definition.clone()).await;
            let first = query_smart_playlist(
                &pool,
                smart.summary.id.clone(),
                SmartPlaylistQuery {
                    limit: 100,
                    offset: 0,
                },
            )
            .await
            .expect("query capped page");
            assert_eq!(first.total, 1);
            assert_eq!(first.items.len(), 1);
            assert_eq!(first.items[0].collection.track.id, "alpha");
            assert!(query_smart_playlist(
                &pool,
                smart.summary.id.clone(),
                SmartPlaylistQuery {
                    limit: 100,
                    offset: 1,
                },
            )
            .await
            .expect("query beyond cap")
            .items
            .is_empty());

            sqlx::query(
                "INSERT INTO play_history (
                   track_id, title_snapshot, artist_snapshot, album_snapshot, source_kind,
                   ended_at, listened_ms, completed, open_slot
                 ) VALUES ('beta', 'beta', '', '', 'context', CURRENT_TIMESTAMP, 180000, 1, NULL)",
            )
            .execute(&pool)
            .await
            .expect("change history revision");
            let after_history = query_smart_playlist(
                &pool,
                smart.summary.id.clone(),
                SmartPlaylistQuery::default(),
            )
            .await
            .expect("query after history");
            assert_ne!(after_history.revision, first.revision);

            sqlx::query("UPDATE songs SET title = 'changed' WHERE id = 'alpha'")
                .execute(&pool)
                .await
                .expect("change catalog revision");
            let after_catalog = query_smart_playlist(
                &pool,
                smart.summary.id.clone(),
                SmartPlaylistQuery::default(),
            )
            .await
            .expect("query after catalog");
            assert_ne!(after_catalog.revision, after_history.revision);

            definition.direction = SmartSortDirection::Asc;
            update_smart_playlist(
                &pool,
                smart.summary.id.clone(),
                "Capped".to_owned(),
                definition,
            )
            .await
            .expect("change rule revision");
            let after_rules =
                query_smart_playlist(&pool, smart.summary.id, SmartPlaylistQuery::default())
                    .await
                    .expect("query after rules");
            assert_ne!(after_rules.revision, after_catalog.revision);
        });
    }

    #[test]
    fn representative_smart_queries_keep_catalog_and_history_indexes_available() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            for (sql, expected) in [
                (
                    "EXPLAIN QUERY PLAN SELECT id FROM songs WHERE availability = 'available'",
                    "idx_songs_availability_filter",
                ),
                (
                    "EXPLAIN QUERY PLAN SELECT id FROM songs WHERE root_id = 1 AND availability = 'available'",
                    "idx_songs_root_availability",
                ),
                (
                    "EXPLAIN QUERY PLAN SELECT id FROM songs WHERE favorRating >= 1 ORDER BY favorRating, id",
                    "idx_songs_favorite_browse",
                ),
                (
                    "EXPLAIN QUERY PLAN SELECT id FROM songs WHERE dateAdded >= '2026-01-01' ORDER BY dateAdded, id",
                    "idx_songs_date_added_browse",
                ),
                (
                    "EXPLAIN QUERY PLAN SELECT track_id, SUM(completed) FROM play_history GROUP BY track_id",
                    "idx_play_history_track",
                ),
            ] {
                let details = sqlx::query(sql)
                    .fetch_all(&pool)
                    .await
                    .expect("explain representative smart query")
                    .iter()
                    .map(|row| row.get::<String, _>("detail"))
                    .collect::<Vec<_>>()
                    .join("\n");
                assert!(details.contains(expected), "{expected} missing from {details}");
            }
        });
    }
}

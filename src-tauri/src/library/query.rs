use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

pub const DEFAULT_PAGE_SIZE: u32 = 50;
pub const MAX_PAGE_SIZE: u32 = 100;
const MAX_QUERY_LENGTH: usize = 256;
const MAX_CURSOR_LENGTH: usize = 4096;
const CURSOR_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackSort {
    #[default]
    Default,
    Album,
    Artist,
    Date,
    DateAdded,
    Favorite,
    SampleRate,
    Title,
    Track,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    #[default]
    Asc,
    Desc,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackAvailability {
    Available,
    Unavailable,
    #[default]
    Any,
}

fn default_page_size() -> u32 {
    DEFAULT_PAGE_SIZE
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TrackQuery {
    pub album: Option<String>,
    pub artist: Option<String>,
    pub availability: TrackAvailability,
    pub codec: Option<String>,
    pub cursor: Option<String>,
    pub direction: SortDirection,
    pub genre: Option<String>,
    pub limit: u32,
    pub min_favorite_rating: Option<i64>,
    pub path_prefix: Option<String>,
    pub q: String,
    pub root_id: Option<i64>,
    pub sort: TrackSort,
    pub year: Option<i64>,
}

impl Default for TrackQuery {
    fn default() -> Self {
        Self {
            album: None,
            artist: None,
            availability: TrackAvailability::default(),
            codec: None,
            cursor: None,
            direction: SortDirection::default(),
            genre: None,
            limit: default_page_size(),
            min_favorite_rating: None,
            path_prefix: None,
            q: String::new(),
            root_id: None,
            sort: TrackSort::default(),
            year: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NormalizedTrackQuery {
    pub album: Option<String>,
    pub artist: Option<String>,
    pub availability: TrackAvailability,
    pub codec: Option<String>,
    pub cursor: Option<String>,
    pub direction: SortDirection,
    pub fingerprint: String,
    pub genre: Option<String>,
    pub limit: u32,
    pub min_favorite_rating: Option<i64>,
    pub path_prefix: Option<String>,
    pub q: String,
    pub root_id: Option<i64>,
    pub sort: TrackSort,
    pub year: Option<i64>,
}

impl TrackQuery {
    pub(crate) fn normalize(&self) -> Result<NormalizedTrackQuery, LibraryError> {
        if self.limit == 0 {
            return Err(LibraryError::invalid_query(
                "Track page size must be at least one.",
            ));
        }

        let q = self.q.trim().to_owned();
        if q.chars().count() > MAX_QUERY_LENGTH {
            return Err(LibraryError::invalid_query("Track search is too long."));
        }
        let limit = self.limit.min(MAX_PAGE_SIZE);
        for filter in [
            self.album.as_deref(),
            self.artist.as_deref(),
            self.codec.as_deref(),
            self.genre.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if filter.chars().count() > 1_024 {
                return Err(LibraryError::invalid_query("Track filter is too long."));
            }
        }
        if self
            .min_favorite_rating
            .is_some_and(|rating| !(0..=2).contains(&rating))
        {
            return Err(LibraryError::invalid_query(
                "Minimum favorite rating must be between zero and two.",
            ));
        }
        if self.year.is_some_and(|year| !(1..=9_999).contains(&year)) {
            return Err(LibraryError::invalid_query(
                "Track year must be between one and 9999.",
            ));
        }
        if self.root_id.is_none() && self.path_prefix.is_some() {
            return Err(LibraryError::invalid_query(
                "A storage path filter requires a library root.",
            ));
        }
        if self.root_id.is_some_and(|root_id| root_id < 0) {
            return Err(LibraryError::invalid_query(
                "Library root identifiers cannot be negative.",
            ));
        }
        if let Some(path_prefix) = self.path_prefix.as_deref() {
            if self.root_id == Some(0) {
                if path_prefix.is_empty() || path_prefix.chars().count() > 1_024 {
                    return Err(LibraryError::invalid_query(
                        "Imported track identifiers are invalid.",
                    ));
                }
            } else {
                validate_relative_path(path_prefix)?;
            }
        }
        let fingerprint_source = serde_json::json!({
            "album": self.album,
            "artist": self.artist,
            "availability": self.availability,
            "codec": self.codec,
            "direction": self.direction,
            "genre": self.genre,
            "limit": limit,
            "minFavoriteRating": self.min_favorite_rating,
            "pathPrefix": self.path_prefix,
            "q": q.to_lowercase(),
            "rootId": self.root_id,
            "sort": self.sort,
            "year": self.year,
        });
        let fingerprint = format!("{:x}", md5::compute(fingerprint_source.to_string()));

        Ok(NormalizedTrackQuery {
            album: self.album.clone(),
            artist: self.artist.clone(),
            availability: self.availability,
            codec: self.codec.clone(),
            cursor: self.cursor.clone(),
            direction: self.direction,
            fingerprint,
            genre: self.genre.clone(),
            limit,
            min_favorite_rating: self.min_favorite_rating,
            path_prefix: self.path_prefix.clone(),
            q,
            root_id: self.root_id,
            sort: self.sort,
            year: self.year,
        })
    }
}

pub(super) fn validate_relative_path(path: &str) -> Result<(), LibraryError> {
    if path.chars().count() > 4_096
        || path.starts_with('/')
        || path.ends_with('/')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(LibraryError::invalid_query(
            "Storage paths must be normalized relative paths.",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryError {
    pub code: String,
    pub message: String,
}

impl LibraryError {
    pub(crate) fn database() -> Self {
        Self {
            code: "database_unavailable".to_owned(),
            message: "The music library is temporarily unavailable.".to_owned(),
        }
    }

    pub(crate) fn invalid_cursor(message: &str) -> Self {
        Self {
            code: "invalid_cursor".to_owned(),
            message: message.to_owned(),
        }
    }

    pub(crate) fn invalid_query(message: &str) -> Self {
        Self {
            code: "invalid_query".to_owned(),
            message: message.to_owned(),
        }
    }

    pub(crate) fn invalid_root(message: &str) -> Self {
        Self {
            code: "invalid_library_root".to_owned(),
            message: message.to_owned(),
        }
    }

    pub(crate) fn root_not_found() -> Self {
        Self {
            code: "library_root_not_found".to_owned(),
            message: "That library folder is no longer registered.".to_owned(),
        }
    }

    pub(crate) fn scan_in_progress() -> Self {
        Self {
            code: "library_scan_in_progress".to_owned(),
            message: "That library folder is already being scanned.".to_owned(),
        }
    }

    pub(crate) fn scan_not_found() -> Self {
        Self {
            code: "library_scan_not_found".to_owned(),
            message: "That library scan is no longer available.".to_owned(),
        }
    }

    pub(crate) fn scan_not_ready() -> Self {
        Self {
            code: "library_scan_not_ready".to_owned(),
            message: "Only the latest completed library scan can be prepared.".to_owned(),
        }
    }

    pub(crate) fn reconciliation_in_progress() -> Self {
        Self {
            code: "library_reconciliation_in_progress".to_owned(),
            message: "That library snapshot is already being prepared.".to_owned(),
        }
    }

    pub(crate) fn reconciliation_not_found() -> Self {
        Self {
            code: "library_reconciliation_not_found".to_owned(),
            message: "That library preparation is no longer available.".to_owned(),
        }
    }

    pub(crate) fn reconciliation_not_ready() -> Self {
        Self {
            code: "library_reconciliation_not_ready".to_owned(),
            message: "That library snapshot is not ready to apply.".to_owned(),
        }
    }

    pub(crate) fn identity_collision() -> Self {
        Self {
            code: "library_identity_collision".to_owned(),
            message: "Jukebox could not safely assign an identity to a discovered track."
                .to_owned(),
        }
    }

    pub(crate) fn refresh_in_progress() -> Self {
        Self {
            code: "library_refresh_in_progress".to_owned(),
            message: "That library folder is already being refreshed.".to_owned(),
        }
    }

    pub(crate) fn stale_cursor() -> Self {
        Self {
            code: "stale_cursor".to_owned(),
            message: "The music library changed. Restart this query from the first page."
                .to_owned(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub(crate) enum CursorValue {
    Integer(i64),
    Text(String),
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorPayload {
    fingerprint: String,
    last_song_id: String,
    revision: i64,
    sort_values: Vec<CursorValue>,
    version: u8,
}

fn expected_cursor_types(sort: TrackSort) -> &'static [bool] {
    // true denotes text; false denotes an integer.
    match sort {
        TrackSort::Default => &[true, true, false, false, true],
        TrackSort::Album | TrackSort::Artist => &[true, true, false],
        TrackSort::Track => &[false, true],
        TrackSort::Date | TrackSort::Favorite | TrackSort::SampleRate => &[false],
        TrackSort::DateAdded | TrackSort::Title => &[true],
    }
}

pub(crate) fn encode_cursor(
    query: &NormalizedTrackQuery,
    revision: i64,
    sort_values: Vec<CursorValue>,
    last_song_id: String,
) -> Result<String, LibraryError> {
    validate_cursor_values(query.sort, &sort_values, &last_song_id)?;
    let payload = CursorPayload {
        fingerprint: query.fingerprint.clone(),
        last_song_id,
        revision,
        sort_values,
        version: CURSOR_VERSION,
    };
    let json = serde_json::to_vec(&payload)
        .map_err(|_| LibraryError::invalid_cursor("Cursor encoding failed."))?;
    let encoded = URL_SAFE_NO_PAD.encode(json);
    if encoded.len() > MAX_CURSOR_LENGTH {
        return Err(LibraryError::invalid_cursor("Cursor is too long."));
    }
    Ok(encoded)
}

pub(crate) fn decode_cursor(
    encoded: &str,
    query: &NormalizedTrackQuery,
    revision: i64,
) -> Result<(Vec<CursorValue>, String), LibraryError> {
    if encoded.is_empty() || encoded.len() > MAX_CURSOR_LENGTH {
        return Err(LibraryError::invalid_cursor("Cursor length is invalid."));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| LibraryError::invalid_cursor("Cursor encoding is invalid."))?;
    let payload: CursorPayload = serde_json::from_slice(&bytes)
        .map_err(|_| LibraryError::invalid_cursor("Cursor payload is invalid."))?;
    if payload.version != CURSOR_VERSION {
        return Err(LibraryError::invalid_cursor(
            "Cursor version is unsupported.",
        ));
    }
    if payload.fingerprint != query.fingerprint {
        return Err(LibraryError::invalid_cursor(
            "Cursor does not match this query.",
        ));
    }
    if payload.revision != revision {
        return Err(LibraryError::stale_cursor());
    }
    validate_cursor_values(query.sort, &payload.sort_values, &payload.last_song_id)?;
    Ok((payload.sort_values, payload.last_song_id))
}

fn validate_cursor_values(
    sort: TrackSort,
    values: &[CursorValue],
    last_song_id: &str,
) -> Result<(), LibraryError> {
    if last_song_id.is_empty() || last_song_id.len() > 512 {
        return Err(LibraryError::invalid_cursor("Cursor song ID is invalid."));
    }
    let expected = expected_cursor_types(sort);
    if values.len() != expected.len() {
        return Err(LibraryError::invalid_cursor(
            "Cursor sort tuple is invalid.",
        ));
    }
    for (value, expects_text) in values.iter().zip(expected) {
        match (value, expects_text) {
            (CursorValue::Text(text), true) if text.len() <= 1024 => {}
            (CursorValue::Integer(_), false) => {}
            _ => {
                return Err(LibraryError::invalid_cursor(
                    "Cursor sort value is invalid.",
                ))
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn normalized_query() -> NormalizedTrackQuery {
        TrackQuery {
            limit: 25,
            sort: TrackSort::Artist,
            ..TrackQuery::default()
        }
        .normalize()
        .expect("normalize query")
    }

    #[test]
    fn query_contract_serializes_with_stable_camel_case_fields() {
        let json = serde_json::to_value(TrackQuery {
            album: Some("Homogenic".to_owned()),
            artist: Some("Björk".to_owned()),
            availability: TrackAvailability::Available,
            codec: Some("flac".to_owned()),
            direction: SortDirection::Desc,
            genre: Some("Electronic".to_owned()),
            limit: 25,
            min_favorite_rating: Some(1),
            q: "Björk".to_owned(),
            sort: TrackSort::DateAdded,
            year: Some(1997),
            ..TrackQuery::default()
        })
        .expect("serialize query");

        assert_eq!(json["direction"], "desc");
        assert_eq!(json["album"], "Homogenic");
        assert_eq!(json["artist"], "Björk");
        assert_eq!(json["availability"], "available");
        assert_eq!(json["codec"], "flac");
        assert_eq!(json["genre"], "Electronic");
        assert_eq!(json["minFavoriteRating"], 1);
        assert_eq!(json["sort"], "date_added");
        assert_eq!(json["year"], 1997);
        assert_eq!(json["limit"], 25);
        assert_eq!(json["q"], "Björk");
    }

    #[test]
    fn cursor_round_trip_validates_revision_query_and_types() {
        let query = normalized_query();
        let values = vec![
            CursorValue::Text("Artist".to_owned()),
            CursorValue::Text("Album".to_owned()),
            CursorValue::Integer(2),
        ];
        let encoded =
            encode_cursor(&query, 7, values.clone(), "song-2".to_owned()).expect("encode cursor");

        assert_eq!(
            decode_cursor(&encoded, &query, 7).expect("decode cursor"),
            (values, "song-2".to_owned())
        );
        assert_eq!(
            decode_cursor(&encoded, &query, 8)
                .expect_err("reject stale cursor")
                .code,
            "stale_cursor"
        );
        let other_query = TrackQuery {
            q: "different".to_owned(),
            ..TrackQuery::default()
        }
        .normalize()
        .expect("normalize other query");
        assert_eq!(
            decode_cursor(&encoded, &other_query, 7)
                .expect_err("reject query mismatch")
                .code,
            "invalid_cursor"
        );
    }

    #[test]
    fn cursor_rejects_malformed_oversized_and_wrong_type_payloads() {
        let query = normalized_query();
        assert_eq!(
            decode_cursor("not-base64!", &query, 1)
                .expect_err("reject malformed cursor")
                .code,
            "invalid_cursor"
        );
        assert_eq!(
            decode_cursor(&"a".repeat(MAX_CURSOR_LENGTH + 1), &query, 1)
                .expect_err("reject long cursor")
                .code,
            "invalid_cursor"
        );
        assert_eq!(
            encode_cursor(
                &query,
                1,
                vec![
                    CursorValue::Integer(1),
                    CursorValue::Text("Album".to_owned()),
                    CursorValue::Integer(2),
                ],
                "song".to_owned(),
            )
            .expect_err("reject wrong sort type")
            .code,
            "invalid_cursor"
        );
    }

    #[test]
    fn query_normalization_enforces_bounds_and_stable_fingerprints() {
        assert_eq!(
            TrackQuery {
                limit: 1000,
                q: "  Search  ".to_owned(),
                ..TrackQuery::default()
            }
            .normalize()
            .expect("normalize bounded query")
            .limit,
            MAX_PAGE_SIZE
        );
        assert_eq!(
            TrackQuery {
                limit: 0,
                ..TrackQuery::default()
            }
            .normalize()
            .expect_err("reject zero limit")
            .code,
            "invalid_query"
        );
        for query in [
            TrackQuery {
                min_favorite_rating: Some(3),
                ..TrackQuery::default()
            },
            TrackQuery {
                year: Some(0),
                ..TrackQuery::default()
            },
        ] {
            assert_eq!(
                query
                    .normalize()
                    .expect_err("reject invalid numeric filter")
                    .code,
                "invalid_query"
            );
        }
    }
}

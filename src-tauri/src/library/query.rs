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

fn default_page_size() -> u32 {
    DEFAULT_PAGE_SIZE
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TrackQuery {
    pub cursor: Option<String>,
    pub direction: SortDirection,
    pub limit: u32,
    pub q: String,
    pub sort: TrackSort,
}

impl Default for TrackQuery {
    fn default() -> Self {
        Self {
            cursor: None,
            direction: SortDirection::default(),
            limit: default_page_size(),
            q: String::new(),
            sort: TrackSort::default(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NormalizedTrackQuery {
    pub cursor: Option<String>,
    pub direction: SortDirection,
    pub fingerprint: String,
    pub limit: u32,
    pub q: String,
    pub sort: TrackSort,
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
        let fingerprint_source = serde_json::json!({
            "direction": self.direction,
            "limit": limit,
            "q": q.to_lowercase(),
            "sort": self.sort,
        });
        let fingerprint = format!("{:x}", md5::compute(fingerprint_source.to_string()));

        Ok(NormalizedTrackQuery {
            cursor: self.cursor.clone(),
            direction: self.direction,
            fingerprint,
            limit,
            q,
            sort: self.sort,
        })
    }
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
            direction: SortDirection::Desc,
            limit: 25,
            q: "Björk".to_owned(),
            sort: TrackSort::DateAdded,
            ..TrackQuery::default()
        })
        .expect("serialize query");

        assert_eq!(json["direction"], "desc");
        assert_eq!(json["sort"], "date_added");
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
    }
}

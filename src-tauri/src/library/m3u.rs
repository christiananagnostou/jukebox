use super::playlists::{create_imported_playlist, validate_playlist_id, PlaylistSummary};
use super::query::{LibraryError, MAX_PAGE_SIZE};
use getrandom::fill;
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri_plugin_dialog::DialogExt;
use tempfile::NamedTempFile;

const MAX_M3U_BYTES: u64 = 8 * 1024 * 1024;
const MAX_M3U_ENTRIES: usize = 100_000;
const MAX_M3U_LINES: usize = 200_000;
const MAX_M3U_PATH_BYTES: usize = 32_768;
const MAX_PENDING_IMPORTS: usize = 4;
const MAX_ISSUE_OFFSET: u32 = 100_000;
const PENDING_IMPORT_TTL: Duration = Duration::from_secs(15 * 60);
const TOKEN_BYTES: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum M3uImportIssueKind {
    Ambiguous,
    Missing,
    Unavailable,
    Unmatched,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M3uImportIssue {
    pub kind: M3uImportIssueKind,
    pub line: u32,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M3uImportPreview {
    pub ambiguous_entries: u32,
    pub duplicate_entries: u32,
    pub matched_entries: u32,
    pub missing_entries: u32,
    pub suggested_name: String,
    pub token: String,
    pub total_entries: u32,
    pub unavailable_entries: u32,
    pub unmatched_entries: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct M3uIssueQuery {
    pub limit: u32,
    pub offset: u32,
}

impl Default for M3uIssueQuery {
    fn default() -> Self {
        Self {
            limit: 50,
            offset: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M3uIssuePage {
    pub items: Vec<M3uImportIssue>,
    pub total: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M3uImportResult {
    pub playlist: PlaylistSummary,
    pub skipped_entries: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M3uExportResult {
    pub exported_entries: u32,
    pub skipped_unavailable_entries: u32,
}

#[derive(Clone, Debug)]
struct PendingImport {
    created_at: Instant,
    issues: Vec<M3uImportIssue>,
    preview: M3uImportPreview,
    song_ids: Vec<String>,
}

#[derive(Clone, Default)]
pub struct M3uState {
    pending: Arc<Mutex<VecDeque<PendingImport>>>,
}

impl M3uState {
    fn insert(&self, pending: PendingImport) -> Result<M3uImportPreview, LibraryError> {
        let preview = pending.preview.clone();
        let mut imports = self.pending.lock().map_err(|_| LibraryError::database())?;
        prune_expired(&mut imports);
        while imports.len() >= MAX_PENDING_IMPORTS {
            imports.pop_front();
        }
        imports.push_back(pending);
        Ok(preview)
    }

    fn get(&self, token: &str) -> Result<PendingImport, LibraryError> {
        validate_token(token)?;
        let mut imports = self.pending.lock().map_err(|_| LibraryError::database())?;
        prune_expired(&mut imports);
        imports
            .iter()
            .find(|pending| pending.preview.token == token)
            .cloned()
            .ok_or_else(import_plan_unavailable)
    }

    fn remove(&self, token: &str) -> Result<bool, LibraryError> {
        validate_token(token)?;
        let mut imports = self.pending.lock().map_err(|_| LibraryError::database())?;
        prune_expired(&mut imports);
        let previous = imports.len();
        imports.retain(|pending| pending.preview.token != token);
        Ok(imports.len() != previous)
    }
}

fn prune_expired(imports: &mut VecDeque<PendingImport>) {
    prune_expired_at(imports, Instant::now());
}

fn prune_expired_at(imports: &mut VecDeque<PendingImport>, now: Instant) {
    imports
        .retain(|pending| now.saturating_duration_since(pending.created_at) <= PENDING_IMPORT_TTL);
}

fn import_plan_unavailable() -> LibraryError {
    LibraryError::invalid_query("That playlist import has expired or is no longer available.")
}

fn generated_token() -> Result<String, LibraryError> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    fill(&mut bytes).map_err(|_| LibraryError::database())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn validate_token(token: &str) -> Result<(), LibraryError> {
    if token.len() == TOKEN_BYTES * 2 && token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(import_plan_unavailable())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ParsedEntry {
    line: u32,
    raw: String,
}

fn parse_m3u(bytes: &[u8]) -> Result<Vec<ParsedEntry>, LibraryError> {
    if bytes.len() as u64 > MAX_M3U_BYTES {
        return Err(LibraryError::invalid_query(
            "The selected playlist is larger than the supported import limit.",
        ));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| {
        LibraryError::invalid_query("M3U imports must be valid UTF-8 or use the M3U8 format.")
    })?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut entries = Vec::new();
    for (index, line) in text.lines().enumerate() {
        if index >= MAX_M3U_LINES {
            return Err(LibraryError::invalid_query(
                "The selected playlist contains too many lines.",
            ));
        }
        let line_number = u32::try_from(index + 1).map_err(|_| {
            LibraryError::invalid_query("The selected playlist has too many lines.")
        })?;
        let line = line.trim().trim_end_matches('\r');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.contains('\0') || line.len() > MAX_M3U_PATH_BYTES {
            return Err(LibraryError::invalid_query(
                "One playlist entry is invalid or exceeds the supported path length.",
            ));
        }
        if entries.len() >= MAX_M3U_ENTRIES {
            return Err(LibraryError::invalid_query(
                "The selected playlist contains more than 100,000 entries.",
            ));
        }
        entries.push(ParsedEntry {
            line: line_number,
            raw: line.to_owned(),
        });
    }
    if entries.is_empty() {
        return Err(LibraryError::invalid_query(
            "The selected playlist does not contain any track paths.",
        ));
    }
    Ok(entries)
}

#[derive(Clone)]
struct CandidateEntry {
    candidates: Vec<String>,
    line: u32,
    name: String,
}

fn is_windows_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\'))
        || value.starts_with("\\\\")
        || value.starts_with("//")
}

fn display_name(value: &str) -> String {
    value
        .rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .unwrap_or("Playlist entry")
        .chars()
        .take(256)
        .collect()
}

fn local_relative_path(value: &str) -> PathBuf {
    let local = if std::path::MAIN_SEPARATOR == '\\' {
        value.replace('/', "\\")
    } else {
        value.replace('\\', "/")
    };
    PathBuf::from(local)
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn candidate_entries(
    entries: &[ParsedEntry],
    roots: &[PathBuf],
    source_directory: &Path,
) -> Vec<CandidateEntry> {
    entries
        .iter()
        .map(|entry| {
            let local = local_relative_path(&entry.raw);
            let absolute = local.is_absolute() || is_windows_absolute(&entry.raw);
            let mut candidates = Vec::new();
            if absolute {
                candidates.push(lexical_normalize(&local).to_string_lossy().into_owned());
            } else {
                for root in roots {
                    candidates.push(
                        lexical_normalize(&root.join(&local))
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
                candidates.push(
                    lexical_normalize(&source_directory.join(local))
                        .to_string_lossy()
                        .into_owned(),
                );
            }
            let mut seen = HashSet::new();
            candidates.retain(|candidate| seen.insert(path_key(candidate)));
            CandidateEntry {
                candidates,
                line: entry.line,
                name: display_name(&entry.raw),
            }
        })
        .collect()
}

fn path_key(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    if cfg!(target_os = "windows") {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

#[derive(Clone)]
struct CatalogPathMatch {
    availability: String,
    id: String,
}

async fn catalog_matches(
    pool: &SqlitePool,
    entries: &[CandidateEntry],
) -> Result<HashMap<String, Vec<CatalogPathMatch>>, LibraryError> {
    let unique_paths = entries
        .iter()
        .flat_map(|entry| entry.candidates.iter().cloned())
        .collect::<HashSet<_>>();
    let mut matches: HashMap<String, Vec<CatalogPathMatch>> = HashMap::new();
    for chunk in unique_paths.iter().collect::<Vec<_>>().chunks(500) {
        let mut query =
            QueryBuilder::<Sqlite>::new("SELECT id, path, availability FROM songs WHERE ");
        if cfg!(target_os = "windows") {
            query.push("path COLLATE NOCASE IN (");
        } else {
            query.push("path IN (");
        }
        let mut separated = query.separated(", ");
        for path in chunk {
            separated.push_bind((*path).clone());
        }
        separated.push_unseparated(")");
        for row in query
            .build()
            .fetch_all(pool)
            .await
            .map_err(|_| LibraryError::database())?
        {
            let path: String = row.try_get("path").map_err(|_| LibraryError::database())?;
            matches
                .entry(path_key(&path))
                .or_default()
                .push(CatalogPathMatch {
                    availability: row
                        .try_get("availability")
                        .map_err(|_| LibraryError::database())?,
                    id: row.try_get("id").map_err(|_| LibraryError::database())?,
                });
        }
    }
    Ok(matches)
}

fn duplicate_count(entries: &[ParsedEntry]) -> u32 {
    let mut seen = HashSet::new();
    entries
        .iter()
        .filter(|entry| !seen.insert(path_key(&entry.raw)))
        .count() as u32
}

struct ResolvedImport {
    issues: Vec<M3uImportIssue>,
    song_ids: Vec<String>,
}

fn resolve_candidates(
    entries: Vec<CandidateEntry>,
    matches: HashMap<String, Vec<CatalogPathMatch>>,
) -> ResolvedImport {
    let mut issues = Vec::new();
    let mut song_ids = Vec::new();
    for entry in entries {
        let mut available_ids = Vec::new();
        let mut has_unavailable = false;
        for candidate in &entry.candidates {
            if let Some(found) = matches.get(&path_key(candidate)) {
                for item in found {
                    if item.availability == "available" {
                        if !available_ids.contains(&item.id) {
                            available_ids.push(item.id.clone());
                        }
                    } else {
                        has_unavailable = true;
                    }
                }
            }
        }
        match available_ids.as_slice() {
            [song_id] => song_ids.push(song_id.clone()),
            [_, ..] => issues.push(M3uImportIssue {
                kind: M3uImportIssueKind::Ambiguous,
                line: entry.line,
                name: entry.name,
            }),
            [] if has_unavailable => issues.push(M3uImportIssue {
                kind: M3uImportIssueKind::Unavailable,
                line: entry.line,
                name: entry.name,
            }),
            [] => {
                let exists = entry
                    .candidates
                    .iter()
                    .any(|candidate| Path::new(candidate).is_file());
                issues.push(M3uImportIssue {
                    kind: if exists {
                        M3uImportIssueKind::Unmatched
                    } else {
                        M3uImportIssueKind::Missing
                    },
                    line: entry.line,
                    name: entry.name,
                });
            }
        }
    }
    ResolvedImport { issues, song_ids }
}

fn suggested_name(path: &Path) -> String {
    let value = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Imported playlist")
        .trim();
    let value = value
        .chars()
        .filter(|character| !character.is_control())
        .take(200)
        .collect::<String>();
    if value.is_empty() {
        "Imported playlist".to_owned()
    } else {
        value
    }
}

async fn prepare_import(
    pool: &SqlitePool,
    source_path: PathBuf,
    bytes: Vec<u8>,
) -> Result<PendingImport, LibraryError> {
    let entries = parse_m3u(&bytes)?;
    let roots = sqlx::query_scalar::<_, String>(
        "SELECT canonical_path FROM library_roots WHERE enabled = 1 ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| LibraryError::database())?
    .into_iter()
    .map(PathBuf::from)
    .collect::<Vec<_>>();
    let source_directory = source_path.parent().unwrap_or_else(|| Path::new("."));
    let candidates = candidate_entries(&entries, &roots, source_directory);
    let matches = catalog_matches(pool, &candidates).await?;
    let resolved =
        tauri::async_runtime::spawn_blocking(move || resolve_candidates(candidates, matches))
            .await
            .map_err(|_| LibraryError::database())?;
    let token = generated_token()?;
    let count = |kind| {
        resolved
            .issues
            .iter()
            .filter(|issue| issue.kind == kind)
            .count() as u32
    };
    let preview = M3uImportPreview {
        ambiguous_entries: count(M3uImportIssueKind::Ambiguous),
        duplicate_entries: duplicate_count(&entries),
        matched_entries: resolved.song_ids.len() as u32,
        missing_entries: count(M3uImportIssueKind::Missing),
        suggested_name: suggested_name(&source_path),
        token,
        total_entries: entries.len() as u32,
        unavailable_entries: count(M3uImportIssueKind::Unavailable),
        unmatched_entries: count(M3uImportIssueKind::Unmatched),
    };
    Ok(PendingImport {
        created_at: Instant::now(),
        issues: resolved.issues,
        preview,
        song_ids: resolved.song_ids,
    })
}

fn read_selected_file(path: &Path) -> Result<Vec<u8>, LibraryError> {
    let metadata = std::fs::metadata(path).map_err(|_| {
        LibraryError::invalid_query("Jukebox could not read the selected playlist file.")
    })?;
    if !metadata.is_file() || metadata.len() > MAX_M3U_BYTES {
        return Err(LibraryError::invalid_query(
            "The selected playlist file is unavailable or too large.",
        ));
    }
    let bytes = std::fs::read(path).map_err(|_| {
        LibraryError::invalid_query("Jukebox could not read the selected playlist file.")
    })?;
    if bytes.len() as u64 > MAX_M3U_BYTES {
        return Err(LibraryError::invalid_query(
            "The selected playlist is larger than the supported import limit.",
        ));
    }
    Ok(bytes)
}

pub(crate) async fn pick_m3u_import(
    app: tauri::AppHandle,
    pool: SqlitePool,
    state: M3uState,
) -> Result<Option<M3uImportPreview>, LibraryError> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .add_filter("M3U playlist", &["m3u", "m3u8"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|_| {
            LibraryError::invalid_query("Jukebox could not read the selected playlist file.")
        })?;
        let bytes = read_selected_file(&path)?;
        Ok::<_, LibraryError>(Some((path, bytes)))
    })
    .await
    .map_err(|_| LibraryError::database())??;
    let Some((path, bytes)) = selected else {
        return Ok(None);
    };
    let pending = prepare_import(&pool, path, bytes).await?;
    state.insert(pending).map(Some)
}

pub(crate) fn list_m3u_import_issues(
    state: &M3uState,
    token: String,
    query: M3uIssueQuery,
) -> Result<M3uIssuePage, LibraryError> {
    if query.limit == 0 || query.offset > MAX_ISSUE_OFFSET {
        return Err(LibraryError::invalid_query(
            "Playlist import issue pages must be present and bounded.",
        ));
    }
    let pending = state.get(&token)?;
    let start = usize::try_from(query.offset).map_err(|_| LibraryError::database())?;
    let end = start
        .saturating_add(query.limit.min(MAX_PAGE_SIZE) as usize)
        .min(pending.issues.len());
    let items = if start >= pending.issues.len() {
        Vec::new()
    } else {
        pending.issues[start..end].to_vec()
    };
    Ok(M3uIssuePage {
        items,
        total: pending.issues.len() as u32,
    })
}

pub(crate) async fn apply_m3u_import(
    pool: &SqlitePool,
    state: &M3uState,
    token: String,
    name: String,
) -> Result<M3uImportResult, LibraryError> {
    let pending = state.get(&token)?;
    let playlist = create_imported_playlist(pool, name, pending.song_ids).await?;
    state.remove(&token)?;
    Ok(M3uImportResult {
        playlist,
        skipped_entries: pending.issues.len() as u32,
    })
}

pub(crate) fn discard_m3u_import(state: &M3uState, token: String) -> Result<bool, LibraryError> {
    state.remove(&token)
}

struct ExportDocument {
    name: String,
    paths: Vec<String>,
    skipped: u32,
}

async fn load_export_document(
    pool: &SqlitePool,
    playlist_id: String,
) -> Result<ExportDocument, LibraryError> {
    validate_playlist_id(&playlist_id)?;
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    let name = sqlx::query_scalar::<_, String>(
        "SELECT name FROM playlists WHERE id = ? AND kind = 'manual'",
    )
    .bind(&playlist_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?
    .ok_or_else(LibraryError::playlist_not_found)?;
    let rows = sqlx::query(
        "SELECT songs.path, songs.availability
         FROM playlist_entries AS entries
         LEFT JOIN songs ON songs.id = entries.song_id
         WHERE entries.playlist_id = ?
         ORDER BY entries.position, entries.id",
    )
    .bind(&playlist_id)
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| LibraryError::database())?;
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    let mut paths = Vec::new();
    let mut skipped = 0_u32;
    for row in rows {
        let availability: Option<String> = row
            .try_get("availability")
            .map_err(|_| LibraryError::database())?;
        let path: Option<String> = row.try_get("path").map_err(|_| LibraryError::database())?;
        if availability.as_deref() == Some("available") {
            if let Some(path) = path {
                if !path
                    .chars()
                    .any(|character| matches!(character, '\0' | '\r' | '\n'))
                {
                    paths.push(path);
                    continue;
                }
            }
        }
        skipped = skipped.saturating_add(1);
    }
    Ok(ExportDocument {
        name,
        paths,
        skipped,
    })
}

fn safe_export_name(name: &str) -> String {
    let name = name
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '/' | '\\' | ':') {
                '-'
            } else {
                character
            }
        })
        .take(180)
        .collect::<String>();
    let name = name.trim_matches([' ', '.']);
    if name.is_empty() {
        "Jukebox playlist".to_owned()
    } else {
        name.to_owned()
    }
}

fn portable_m3u_path(path: &str, base: &str, windows: bool) -> String {
    let path = path.replace('\\', "/");
    let base = base.replace('\\', "/").trim_end_matches('/').to_owned();
    let prefix = format!("{base}/");
    let is_within = if windows {
        path.to_lowercase().starts_with(&prefix.to_lowercase())
    } else {
        path.starts_with(&prefix)
    };
    if is_within {
        let relative = path.get(prefix.len()..).unwrap_or(&path);
        if relative.starts_with('#') {
            format!("./{relative}")
        } else {
            relative.to_owned()
        }
    } else {
        path
    }
}

fn render_m3u8(paths: &[String], destination_directory: &Path) -> String {
    let base = destination_directory.to_string_lossy();
    let mut output = String::from("#EXTM3U\n");
    for path in paths {
        output.push_str(&portable_m3u_path(path, &base, cfg!(target_os = "windows")));
        output.push('\n');
    }
    output
}

fn write_export(path: &Path, contents: &[u8]) -> Result<(), LibraryError> {
    let parent = path.parent().ok_or_else(|| {
        LibraryError::invalid_query("Jukebox could not prepare the selected export location.")
    })?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|_| {
        LibraryError::invalid_query("Jukebox could not prepare the selected export location.")
    })?;
    temporary.write_all(contents).map_err(|_| {
        LibraryError::invalid_query("Jukebox could not write the selected playlist export.")
    })?;
    temporary.as_file().sync_all().map_err(|_| {
        LibraryError::invalid_query("Jukebox could not write the selected playlist export.")
    })?;
    temporary.persist(path).map_err(|_| {
        LibraryError::invalid_query("Jukebox could not replace the selected playlist export.")
    })?;
    Ok(())
}

pub(crate) async fn pick_m3u_export(
    app: tauri::AppHandle,
    pool: SqlitePool,
    playlist_id: String,
) -> Result<Option<M3uExportResult>, LibraryError> {
    let document = load_export_document(&pool, playlist_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .add_filter("M3U8 playlist", &["m3u8", "m3u"])
            .set_file_name(format!("{}.m3u8", safe_export_name(&document.name)))
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let mut path = selected.into_path().map_err(|_| {
            LibraryError::invalid_query("Jukebox could not prepare the selected export location.")
        })?;
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "m3u" | "m3u8") {
            path.set_extension("m3u8");
        }
        let parent = path.parent().ok_or_else(|| {
            LibraryError::invalid_query("Jukebox could not prepare the selected export location.")
        })?;
        let contents = render_m3u8(&document.paths, parent);
        write_export(&path, contents.as_bytes())?;
        Ok(Some(M3uExportResult {
            exported_entries: document.paths.len() as u32,
            skipped_unavailable_entries: document.skipped,
        }))
    })
    .await
    .map_err(|_| LibraryError::database())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::NATIVE_MIGRATOR;
    use crate::library::playlists::{create_playlist, list_playlist_entries, PlaylistEntryQuery};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::fs;

    async fn fixture() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open M3U fixture");
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .expect("enable foreign keys");
        NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate M3U fixture");
        pool
    }

    async fn add_root(pool: &SqlitePool, path: &Path) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO library_roots (path, canonical_path) VALUES (?, ?) RETURNING id",
        )
        .bind(path.to_string_lossy().into_owned())
        .bind(path.to_string_lossy().into_owned())
        .fetch_one(pool)
        .await
        .expect("insert M3U library root")
    }

    async fn add_song(
        pool: &SqlitePool,
        id: &str,
        path: &Path,
        availability: &str,
        root_id: Option<i64>,
    ) {
        sqlx::query(
            "INSERT INTO songs (
               id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
               trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
               favorRating, dateAdded, visualsPath, root_id, normalized_path, availability
             ) VALUES (?, ?, ?, ?, 'Album', 'Artist', '', 0, 0, '2026', '', 1, 1,
                       'flac', '0:03:00.000', '44100', 1, 0, 0, '2026-08-27', '', ?, ?, ?)",
        )
        .bind(id)
        .bind(path.to_string_lossy().into_owned())
        .bind(path.file_name().unwrap().to_string_lossy().into_owned())
        .bind(format!("Track {id}"))
        .bind(root_id)
        .bind(path.file_name().unwrap().to_string_lossy().into_owned())
        .bind(availability)
        .execute(pool)
        .await
        .expect("insert M3U song");
    }

    fn issue(kind: M3uImportIssueKind, line: u32) -> M3uImportIssue {
        M3uImportIssue {
            kind,
            line,
            name: format!("track-{line}.flac"),
        }
    }

    fn pending(
        token: &str,
        created_at: Instant,
        issues: Vec<M3uImportIssue>,
        song_ids: Vec<String>,
    ) -> PendingImport {
        PendingImport {
            created_at,
            preview: M3uImportPreview {
                ambiguous_entries: 0,
                duplicate_entries: 0,
                matched_entries: song_ids.len() as u32,
                missing_entries: 0,
                suggested_name: "Imported".to_owned(),
                token: token.to_owned(),
                total_entries: (song_ids.len() + issues.len()) as u32,
                unavailable_entries: 0,
                unmatched_entries: issues.len() as u32,
            },
            issues,
            song_ids,
        }
    }

    #[test]
    fn parser_accepts_utf8_bom_comments_crlf_and_cross_platform_paths() {
        let input = "\u{feff}#EXTM3U\r\n#EXTINF:1,Ignored\r\nBjörk/Jóga.flac\r\nC:\\Music\\Track.flac\r\n\\\\server\\share\\Song.mp3\r\n\r\n";
        let parsed = parse_m3u(input.as_bytes()).expect("parse portable M3U");

        assert_eq!(
            parsed,
            vec![
                ParsedEntry {
                    line: 3,
                    raw: "Björk/Jóga.flac".to_owned(),
                },
                ParsedEntry {
                    line: 4,
                    raw: "C:\\Music\\Track.flac".to_owned(),
                },
                ParsedEntry {
                    line: 5,
                    raw: "\\\\server\\share\\Song.mp3".to_owned(),
                },
            ]
        );
        assert!(is_windows_absolute(&parsed[1].raw));
        assert!(is_windows_absolute(&parsed[2].raw));
    }

    #[test]
    fn parser_rejects_invalid_utf8_nuls_and_every_size_boundary() {
        assert_eq!(parse_m3u(&[0xff]).unwrap_err().code, "invalid_query");
        assert_eq!(
            parse_m3u(b"bad\0path.flac").unwrap_err().code,
            "invalid_query"
        );
        assert_eq!(
            parse_m3u(format!("{}.flac", "x".repeat(MAX_M3U_PATH_BYTES)).as_bytes())
                .unwrap_err()
                .code,
            "invalid_query"
        );
        assert_eq!(
            parse_m3u(&vec![b'x'; MAX_M3U_BYTES as usize + 1])
                .unwrap_err()
                .code,
            "invalid_query"
        );
        let too_many_entries = "track.flac\n".repeat(MAX_M3U_ENTRIES + 1);
        assert_eq!(
            parse_m3u(too_many_entries.as_bytes()).unwrap_err().code,
            "invalid_query"
        );
        let too_many_lines = "#\n".repeat(MAX_M3U_LINES + 1);
        assert_eq!(
            parse_m3u(too_many_lines.as_bytes()).unwrap_err().code,
            "invalid_query"
        );
        assert_eq!(parse_m3u(b"#EXTM3U\n\n").unwrap_err().code, "invalid_query");
    }

    #[test]
    fn resolver_prefers_roots_preserves_duplicates_and_classifies_every_issue() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let root = tempfile::tempdir().expect("create M3U root");
            let source = tempfile::tempdir().expect("create M3U source");
            let root_id = add_root(&pool, root.path()).await;
            for name in ["root-track.flac", "unavailable.flac"] {
                fs::write(root.path().join(name), b"fixture").expect("write root fixture");
            }
            for name in ["source-track.flac", "unmatched.flac"] {
                fs::write(source.path().join(name), b"fixture").expect("write source fixture");
            }
            add_song(
                &pool,
                "root-track",
                &root.path().join("root-track.flac"),
                "available",
                Some(root_id),
            )
            .await;
            add_song(
                &pool,
                "unavailable",
                &root.path().join("unavailable.flac"),
                "unavailable",
                Some(root_id),
            )
            .await;
            add_song(
                &pool,
                "source-track",
                &source.path().join("source-track.flac"),
                "available",
                None,
            )
            .await;
            let source_path = source.path().join("Portable Mix.m3u8");
            let pending = prepare_import(
                &pool,
                source_path,
                b"root-track.flac\nroot-track.flac\nunavailable.flac\nsource-track.flac\nunmatched.flac\nmissing.flac\n".to_vec(),
            )
            .await
            .expect("prepare M3U import");

            assert_eq!(pending.preview.total_entries, 6);
            assert_eq!(pending.preview.matched_entries, 3);
            assert_eq!(pending.preview.duplicate_entries, 1);
            assert_eq!(pending.preview.unavailable_entries, 1);
            assert_eq!(pending.preview.unmatched_entries, 1);
            assert_eq!(pending.preview.missing_entries, 1);
            assert_eq!(pending.preview.suggested_name, "Portable Mix");
            assert_eq!(
                pending.song_ids,
                vec!["root-track", "root-track", "source-track"]
            );
            assert_eq!(
                pending
                    .issues
                    .iter()
                    .map(|item| (item.kind, item.name.as_str()))
                    .collect::<Vec<_>>(),
                vec![
                    (M3uImportIssueKind::Unavailable, "unavailable.flac"),
                    (M3uImportIssueKind::Unmatched, "unmatched.flac"),
                    (M3uImportIssueKind::Missing, "missing.flac"),
                ]
            );
            assert!(pending
                .issues
                .iter()
                .all(|item| !item.name.contains(source.path().to_string_lossy().as_ref())));
        });
    }

    #[test]
    fn resolver_reports_ambiguous_root_matches_without_guessing() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let first = tempfile::tempdir().expect("create first M3U root");
            let second = tempfile::tempdir().expect("create second M3U root");
            let source = tempfile::tempdir().expect("create ambiguous M3U source");
            for (index, root) in [first.path(), second.path()].into_iter().enumerate() {
                let root_id = add_root(&pool, root).await;
                let path = root.join("same.flac");
                fs::write(&path, b"fixture").expect("write ambiguous fixture");
                add_song(
                    &pool,
                    &format!("same-{index}"),
                    &path,
                    "available",
                    Some(root_id),
                )
                .await;
            }
            let pending = prepare_import(
                &pool,
                source.path().join("Ambiguous.m3u"),
                b"same.flac\n".to_vec(),
            )
            .await
            .expect("prepare ambiguous import");

            assert_eq!(pending.preview.ambiguous_entries, 1);
            assert!(pending.song_ids.is_empty());
            assert_eq!(pending.issues[0].kind, M3uImportIssueKind::Ambiguous);
        });
    }

    #[test]
    fn pending_plans_are_expiring_bounded_token_addressed_and_pageable() {
        let state = M3uState::default();
        let expired_token = "00000000000000000000000000000000";
        let created_at = Instant::now();
        state.pending.lock().unwrap().push_back(pending(
            expired_token,
            created_at,
            Vec::new(),
            vec!["one".to_owned()],
        ));
        prune_expired_at(
            &mut state.pending.lock().unwrap(),
            created_at + PENDING_IMPORT_TTL + Duration::from_secs(1),
        );
        for index in 1..=5 {
            let token = format!("{index:032x}");
            state
                .insert(pending(
                    &token,
                    Instant::now(),
                    (0..125)
                        .map(|offset| issue(M3uImportIssueKind::Unmatched, offset))
                        .collect(),
                    vec!["one".to_owned()],
                ))
                .expect("insert pending import");
        }

        assert_eq!(state.pending.lock().unwrap().len(), MAX_PENDING_IMPORTS);
        assert_eq!(state.get(expired_token).unwrap_err().code, "invalid_query");
        assert_eq!(
            state
                .get("00000000000000000000000000000001")
                .unwrap_err()
                .code,
            "invalid_query"
        );
        let newest = "00000000000000000000000000000005";
        let page = list_m3u_import_issues(
            &state,
            newest.to_owned(),
            M3uIssueQuery {
                limit: 1000,
                offset: 100,
            },
        )
        .expect("page pending issues");
        assert_eq!(page.total, 125);
        assert_eq!(page.items.len(), 25);
        assert_eq!(page.items[0].line, 100);
        assert!(discard_m3u_import(&state, newest.to_owned()).unwrap());
        assert!(!discard_m3u_import(&state, newest.to_owned()).unwrap());
        assert_eq!(
            list_m3u_import_issues(&state, "not-a-token".to_owned(), M3uIssueQuery::default(),)
                .unwrap_err()
                .code,
            "invalid_query"
        );
    }

    #[test]
    fn reviewed_import_applies_exactly_once_atomically_with_order_and_duplicates() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let directory = tempfile::tempdir().expect("create imported playlist fixture");
            for id in ["one", "two"] {
                let path = directory.path().join(format!("{id}.flac"));
                fs::write(&path, b"fixture").expect("write imported track");
                add_song(&pool, id, &path, "available", None).await;
            }
            create_playlist(&pool, "Conflict".to_owned())
                .await
                .expect("create conflicting playlist");
            let state = M3uState::default();
            let conflict_token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            state
                .insert(pending(
                    conflict_token,
                    Instant::now(),
                    vec![issue(M3uImportIssueKind::Missing, 4)],
                    vec!["one".to_owned(), "one".to_owned(), "two".to_owned()],
                ))
                .unwrap();
            assert_eq!(
                apply_m3u_import(
                    &pool,
                    &state,
                    conflict_token.to_owned(),
                    "Conflict".to_owned(),
                )
                .await
                .unwrap_err()
                .code,
                "playlist_name_conflict"
            );
            assert!(state.get(conflict_token).is_ok());

            let result = apply_m3u_import(
                &pool,
                &state,
                conflict_token.to_owned(),
                "Imported".to_owned(),
            )
            .await
            .expect("apply reviewed import");
            assert_eq!(result.skipped_entries, 1);
            assert_eq!(result.playlist.entry_count, 3);
            let page = list_playlist_entries(
                &pool,
                result.playlist.id.clone(),
                PlaylistEntryQuery::default(),
            )
            .await
            .expect("read imported playlist");
            assert_eq!(
                page.items
                    .iter()
                    .map(|entry| entry.song_id.as_str())
                    .collect::<Vec<_>>(),
                vec!["one", "one", "two"]
            );
            assert_eq!(
                apply_m3u_import(&pool, &state, conflict_token.to_owned(), "Again".to_owned(),)
                    .await
                    .unwrap_err()
                    .code,
                "invalid_query"
            );

            let stale_token = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
            state
                .insert(pending(
                    stale_token,
                    Instant::now(),
                    Vec::new(),
                    vec!["two".to_owned()],
                ))
                .unwrap();
            sqlx::query("UPDATE songs SET availability = 'unavailable' WHERE id = 'two'")
                .execute(&pool)
                .await
                .expect("make import plan stale");
            let playlist_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM playlists")
                .fetch_one(&pool)
                .await
                .expect("count playlists before stale import");
            assert_eq!(
                apply_m3u_import(&pool, &state, stale_token.to_owned(), "Stale".to_owned(),)
                    .await
                    .unwrap_err()
                    .code,
                "invalid_query"
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM playlists")
                    .fetch_one(&pool)
                    .await
                    .expect("count playlists after stale import"),
                playlist_count
            );
            assert!(state.get(stale_token).is_ok());
        });
    }

    #[test]
    fn export_preserves_order_uses_portable_paths_and_skips_unavailable_entries() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let directory = tempfile::tempdir().expect("create export fixture");
            let base = directory.path().join("Exports");
            fs::create_dir(&base).expect("create export base");
            let inside = base.join("Artist").join("#song.flac");
            let outside = directory.path().join("outside.flac");
            let unavailable = directory.path().join("unavailable.flac");
            fs::create_dir_all(inside.parent().unwrap()).expect("create nested export path");
            for path in [&inside, &outside, &unavailable] {
                fs::write(path, b"fixture").expect("write export track");
            }
            add_song(&pool, "inside", &inside, "available", None).await;
            add_song(&pool, "outside", &outside, "available", None).await;
            add_song(&pool, "unavailable", &unavailable, "available", None).await;
            let playlist = create_imported_playlist(
                &pool,
                "Export / Mix".to_owned(),
                vec![
                    "inside".to_owned(),
                    "outside".to_owned(),
                    "inside".to_owned(),
                    "unavailable".to_owned(),
                ],
            )
            .await
            .expect("create export playlist");
            sqlx::query("UPDATE songs SET availability = 'unavailable' WHERE id = 'unavailable'")
                .execute(&pool)
                .await
                .expect("make export entry unavailable");

            let document = load_export_document(&pool, playlist.id)
                .await
                .expect("load export document");
            assert_eq!(document.name, "Export / Mix");
            assert_eq!(document.paths.len(), 3);
            assert_eq!(document.skipped, 1);
            let rendered = render_m3u8(&document.paths, &base);
            let portable_outside = outside.to_string_lossy().replace('\\', "/");
            assert_eq!(
                rendered,
                format!(
                    "#EXTM3U\nArtist/#song.flac\n{}\nArtist/#song.flac\n",
                    portable_outside
                )
            );
            assert_eq!(safe_export_name(&document.name), "Export - Mix");
            assert_eq!(
                portable_m3u_path("C:\\Music\\Artist\\Song.flac", "c:\\music", true),
                "Artist/Song.flac"
            );
            assert_eq!(
                portable_m3u_path("/Music/Artist/Song.flac", "/Other", false),
                "/Music/Artist/Song.flac"
            );

            let destination = base.join("mix.m3u8");
            fs::write(&destination, b"old").expect("write previous export");
            write_export(&destination, rendered.as_bytes()).expect("replace export atomically");
            assert_eq!(fs::read_to_string(destination).unwrap(), rendered);
        });
    }

    #[test]
    fn path_errors_are_redacted_and_lookup_indexes_remain_available() {
        tauri::async_runtime::block_on(async {
            let pool = fixture().await;
            let directory = tempfile::tempdir().expect("create redacted path fixture");
            let missing = directory.path().join("private-name.m3u8");
            let error = read_selected_file(&missing).unwrap_err();
            assert!(!error.message.contains(missing.to_string_lossy().as_ref()));

            for (sql, expected) in [
                (
                    "EXPLAIN QUERY PLAN SELECT id FROM songs WHERE path = '/Music/Song.flac'",
                    "idx_songs_path_lookup",
                ),
                (
                    "EXPLAIN QUERY PLAN SELECT id FROM songs WHERE path COLLATE NOCASE = '/music/song.flac'",
                    "idx_songs_path_lookup_nocase",
                ),
            ] {
                let details = sqlx::query(sql)
                    .fetch_all(&pool)
                    .await
                    .expect("explain M3U path lookup")
                    .iter()
                    .map(|row| row.get::<String, _>("detail"))
                    .collect::<Vec<_>>()
                    .join("\n");
                assert!(details.contains(expected), "{expected} missing from {details}");
            }
        });
    }
}

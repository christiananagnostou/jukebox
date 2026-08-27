use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const ACTIVE_LOG: &str = "jukebox.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const MAX_RECENT_ERRORS: usize = 25;
const MAX_ROTATED_LOGS: usize = 3;
const MAX_DETAIL_LENGTH: usize = 512;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    timestamp_unix_ms: u64,
    level: &'static str,
    category: String,
    code: String,
    detail: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSummary {
    app_version: String,
    architecture: String,
    dropped_event_count: u64,
    logging_available: bool,
    operating_system: String,
    recent_errors: Vec<DiagnosticEvent>,
    schema_version: i64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackClientEvent {
    ActivationFailed,
    ActivationRequested,
    ControllerUnavailable,
    InitializationFailed,
    Initializing,
    MediaPlayFailed,
    Ready,
    SourceAuthorizationFailed,
}

impl PlaybackClientEvent {
    fn code(self) -> &'static str {
        match self {
            Self::ActivationFailed => "activation_failed",
            Self::ActivationRequested => "activation_requested",
            Self::ControllerUnavailable => "controller_unavailable",
            Self::InitializationFailed => "initialization_failed",
            Self::Initializing => "initializing",
            Self::MediaPlayFailed => "media_play_failed",
            Self::Ready => "ready",
            Self::SourceAuthorizationFailed => "source_authorization_failed",
        }
    }

    fn is_error(self) -> bool {
        !matches!(
            self,
            Self::ActivationRequested | Self::Initializing | Self::Ready
        )
    }
}

#[derive(Default)]
struct DiagnosticsBuffer {
    dropped_event_count: u64,
    recent_errors: VecDeque<DiagnosticEvent>,
}

struct DiagnosticsInner {
    app_version: String,
    buffer: Mutex<DiagnosticsBuffer>,
    clipboard: Mutex<Option<arboard::Clipboard>>,
    directory: Option<PathBuf>,
    schema_version: i64,
}

#[derive(Clone)]
pub struct DiagnosticsState(Arc<DiagnosticsInner>);

impl DiagnosticsState {
    pub fn new(app: &tauri::AppHandle, schema_version: i64) -> Self {
        let directory = app.path().app_log_dir().ok().and_then(|directory| {
            fs::create_dir_all(&directory).ok()?;
            Some(directory)
        });
        Self::from_parts(
            directory,
            app.package_info().version.to_string(),
            schema_version,
        )
    }

    fn from_parts(directory: Option<PathBuf>, app_version: String, schema_version: i64) -> Self {
        Self(Arc::new(DiagnosticsInner {
            app_version,
            buffer: Mutex::new(DiagnosticsBuffer::default()),
            clipboard: Mutex::new(None),
            directory,
            schema_version,
        }))
    }

    pub fn record_info(&self, category: &str, code: &str, detail: &str) {
        self.record("info", category, code, detail);
    }

    pub fn record_error(&self, category: &str, code: &str, detail: &str) {
        self.record("error", category, code, detail);
    }

    fn record(&self, level: &'static str, category: &str, code: &str, detail: &str) {
        let event = DiagnosticEvent {
            timestamp_unix_ms: timestamp_unix_ms(),
            level,
            category: sanitize_token(category),
            code: sanitize_token(code),
            detail: sanitize_detail(detail),
        };
        let line = match serde_json::to_string(&event) {
            Ok(line) => line,
            Err(_) => return,
        };

        let Ok(mut buffer) = self.0.buffer.lock() else {
            return;
        };
        if level == "error" {
            if buffer.recent_errors.len() == MAX_RECENT_ERRORS {
                buffer.recent_errors.pop_front();
            }
            buffer.recent_errors.push_back(event);
        }
        let Some(directory) = &self.0.directory else {
            buffer.dropped_event_count = buffer.dropped_event_count.saturating_add(1);
            return;
        };
        if append_line(directory, &line, MAX_LOG_BYTES, MAX_ROTATED_LOGS).is_err() {
            buffer.dropped_event_count = buffer.dropped_event_count.saturating_add(1);
        }
    }

    fn summary(&self) -> DiagnosticsSummary {
        let (recent_errors, dropped_event_count) = self
            .0
            .buffer
            .lock()
            .map(|buffer| {
                (
                    buffer.recent_errors.iter().cloned().collect(),
                    buffer.dropped_event_count,
                )
            })
            .unwrap_or_default();
        DiagnosticsSummary {
            app_version: self.0.app_version.clone(),
            architecture: std::env::consts::ARCH.to_owned(),
            dropped_event_count,
            logging_available: self.0.directory.is_some(),
            operating_system: std::env::consts::OS.to_owned(),
            recent_errors,
            schema_version: self.0.schema_version,
        }
    }

    fn open_directory(&self) -> Result<(), String> {
        let directory = self
            .0
            .directory
            .as_ref()
            .ok_or_else(|| "The diagnostics directory is unavailable.".to_owned())?;
        open_path(directory)
            .map_err(|_| "Jukebox could not open the diagnostics directory.".to_owned())
    }

    fn copy_summary(&self) -> Result<(), String> {
        let summary = format_summary(&self.summary());
        let mut clipboard = self
            .0
            .clipboard
            .lock()
            .map_err(|_| "The system clipboard is temporarily unavailable.".to_owned())?;
        if clipboard.is_none() {
            *clipboard = Some(
                arboard::Clipboard::new()
                    .map_err(|_| "The system clipboard is unavailable.".to_owned())?,
            );
        }
        let Some(clipboard) = clipboard.as_mut() else {
            return Err("The system clipboard is unavailable.".to_owned());
        };
        clipboard
            .set_text(summary)
            .map_err(|_| "Jukebox could not copy the diagnostics summary.".to_owned())
    }
}

fn format_summary(summary: &DiagnosticsSummary) -> String {
    let mut lines = vec![
        "Jukebox diagnostics".to_owned(),
        format!("Version: {}", summary.app_version),
        format!(
            "Platform: {} ({})",
            summary.operating_system, summary.architecture
        ),
        format!("Database schema: {}", summary.schema_version),
        format!(
            "Local logging: {}",
            if summary.logging_available {
                "available"
            } else {
                "unavailable"
            }
        ),
        format!("Dropped log events: {}", summary.dropped_event_count),
        String::new(),
        "Recent categorized errors:".to_owned(),
    ];
    if summary.recent_errors.is_empty() {
        lines.push("- None".to_owned());
    } else {
        lines.extend(summary.recent_errors.iter().rev().map(|event| {
            let detail = if event.detail.is_empty() {
                String::new()
            } else {
                format!(" ({})", event.detail)
            };
            format!(
                "- unix_ms={} {}/{}{}",
                event.timestamp_unix_ms, event.category, event.code, detail
            )
        }));
    }
    lines.join("\n")
}

fn sanitize_token(value: &str) -> String {
    let token: String = value
        .chars()
        .take(64)
        .map(|character| {
            if character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '_' | '-' | '.')
            {
                character
            } else {
                '_'
            }
        })
        .collect();
    if token.is_empty() {
        "unknown".to_owned()
    } else {
        token
    }
}

fn sanitize_detail(value: &str) -> String {
    if value.len() > MAX_DETAIL_LENGTH
        || value.contains('/')
        || value.contains('\\')
        || value.contains('~')
        || value.chars().any(|character| character.is_ascii_control())
    {
        return "[redacted]".to_owned();
    }
    if value.is_empty() {
        return String::new();
    }
    let valid = value.split_ascii_whitespace().all(|field| {
        let Some((key, field_value)) = field.split_once('=') else {
            return false;
        };
        match key {
            "schema_version" | "scan_id" | "root_id" | "discovered" | "updated" | "unavailable"
            | "failed" | "elapsed_ms" | "port" => {
                !field_value.is_empty()
                    && field_value
                        .chars()
                        .all(|character| character.is_ascii_digit())
            }
            "defaults_active" | "previous_settings_preserved" | "persisted" => {
                matches!(field_value, "true" | "false")
            }
            "phase" => matches!(field_value, "startup" | "resume"),
            "status" => matches!(
                field_value,
                "pending"
                    | "running"
                    | "preparing"
                    | "ready"
                    | "applying"
                    | "completed"
                    | "cancelled"
                    | "failed"
                    | "interrupted"
                    | "awaiting_preparation"
            ),
            _ => false,
        }
    });
    if valid {
        value.to_owned()
    } else {
        "[redacted]".to_owned()
    }
}

fn timestamp_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or_default()
}

fn append_line(
    directory: &Path,
    line: &str,
    max_bytes: u64,
    max_rotated_logs: usize,
) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    let active = directory.join(ACTIVE_LOG);
    let required = u64::try_from(line.len().saturating_add(1)).unwrap_or(u64::MAX);
    let current = fs::metadata(&active)
        .map(|metadata| metadata.len())
        .unwrap_or_default();
    if current > 0 && current.saturating_add(required) > max_bytes {
        rotate_logs(directory, max_rotated_logs)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(active)?;
    writeln!(file, "{line}")
}

fn rotate_logs(directory: &Path, max_rotated_logs: usize) -> std::io::Result<()> {
    if max_rotated_logs == 0 {
        let active = directory.join(ACTIVE_LOG);
        if active.exists() {
            fs::remove_file(active)?;
        }
        return Ok(());
    }
    let oldest = directory.join(format!("{ACTIVE_LOG}.{max_rotated_logs}"));
    if oldest.exists() {
        fs::remove_file(oldest)?;
    }
    for index in (1..max_rotated_logs).rev() {
        let source = directory.join(format!("{ACTIVE_LOG}.{index}"));
        if source.exists() {
            fs::rename(
                source,
                directory.join(format!("{ACTIVE_LOG}.{}", index + 1)),
            )?;
        }
    }
    let active = directory.join(ACTIVE_LOG);
    if active.exists() {
        fs::rename(active, directory.join(format!("{ACTIVE_LOG}.1")))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_path(path: &Path) -> std::io::Result<()> {
    Command::new("/usr/bin/open").arg(path).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn open_path(path: &Path) -> std::io::Result<()> {
    Command::new("explorer.exe").arg(path).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path(path: &Path) -> std::io::Result<()> {
    Command::new("xdg-open").arg(path).spawn().map(|_| ())
}

#[tauri::command]
pub fn copy_diagnostics_summary(
    diagnostics: tauri::State<'_, DiagnosticsState>,
) -> Result<(), String> {
    diagnostics.copy_summary()
}

#[tauri::command]
pub fn get_diagnostics_summary(
    diagnostics: tauri::State<'_, DiagnosticsState>,
) -> DiagnosticsSummary {
    diagnostics.summary()
}

#[tauri::command]
pub fn open_diagnostics_directory(
    diagnostics: tauri::State<'_, DiagnosticsState>,
) -> Result<(), String> {
    diagnostics.open_directory()
}

#[tauri::command]
pub fn record_playback_client_event(
    diagnostics: tauri::State<'_, DiagnosticsState>,
    event: PlaybackClientEvent,
) {
    if event.is_error() {
        diagnostics.record_error("playback_client", event.code(), "");
    } else {
        diagnostics.record_info("playback_client", event.code(), "");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_client_events_have_fixed_path_free_codes() {
        let events = [
            PlaybackClientEvent::ActivationFailed,
            PlaybackClientEvent::ActivationRequested,
            PlaybackClientEvent::ControllerUnavailable,
            PlaybackClientEvent::InitializationFailed,
            PlaybackClientEvent::Initializing,
            PlaybackClientEvent::MediaPlayFailed,
            PlaybackClientEvent::Ready,
            PlaybackClientEvent::SourceAuthorizationFailed,
        ];
        for event in events {
            assert!(!event.code().is_empty());
            assert!(!event.code().contains('/'));
            assert!(!event.code().contains('\\'));
        }
    }

    #[test]
    fn details_with_path_separators_are_redacted() {
        let unix_path = ["", "Users", "example", "Music", "song.flac"].join("/");
        let windows_path = ["C:", "Users", "example", "song.flac"].join("\\");
        assert_eq!(sanitize_detail(&unix_path), "[redacted]");
        assert_eq!(sanitize_detail(&windows_path), "[redacted]");
        assert_eq!(
            sanitize_detail("scan_id=12 failed=3"),
            "scan_id=12 failed=3"
        );
        assert_eq!(sanitize_detail("device=workstation"), "[redacted]");
        assert_eq!(sanitize_detail("status=workstation"), "[redacted]");
    }

    #[test]
    fn recent_errors_are_bounded_and_do_not_include_info_events() {
        let state = DiagnosticsState::from_parts(None, "1.0.0".to_owned(), 9);
        state.record_info("application", "startup", "schema_version=9");
        for index in 0..(MAX_RECENT_ERRORS + 5) {
            state.record_error("library_refresh", "failed", &format!("scan_id={index}"));
        }

        let summary = state.summary();

        assert_eq!(summary.recent_errors.len(), MAX_RECENT_ERRORS);
        assert_eq!(summary.recent_errors[0].detail, "scan_id=5");
        assert_eq!(summary.dropped_event_count, (MAX_RECENT_ERRORS + 6) as u64);
        assert!(!summary.logging_available);
    }

    #[test]
    fn log_rotation_keeps_the_configured_number_of_files() {
        let directory = tempfile::tempdir().expect("create log directory");
        for index in 0..8 {
            append_line(directory.path(), &format!("event-{index}-xxxxxxxx"), 24, 3)
                .expect("append log line");
        }

        assert!(directory.path().join(ACTIVE_LOG).is_file());
        assert!(directory.path().join(format!("{ACTIVE_LOG}.1")).is_file());
        assert!(directory.path().join(format!("{ACTIVE_LOG}.2")).is_file());
        assert!(directory.path().join(format!("{ACTIVE_LOG}.3")).is_file());
        assert!(!directory.path().join(format!("{ACTIVE_LOG}.4")).exists());
    }

    #[test]
    fn summaries_expose_platform_state_without_log_paths() {
        let directory = tempfile::tempdir().expect("create log directory");
        let state = DiagnosticsState::from_parts(
            Some(directory.path().to_path_buf()),
            "2.3.4".to_owned(),
            9,
        );
        state.record_error("settings", "invalid_json", "defaults_active=true");

        let summary = state.summary();
        let encoded = serde_json::to_string(&summary).expect("serialize summary");

        assert_eq!(summary.app_version, "2.3.4");
        assert_eq!(summary.schema_version, 9);
        assert!(summary.logging_available);
        assert!(!encoded.contains(directory.path().to_string_lossy().as_ref()));
        assert!(format_summary(&summary).contains("settings/invalid_json"));
    }
}

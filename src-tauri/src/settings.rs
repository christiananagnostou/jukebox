use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::Manager;

use crate::diagnostics::DiagnosticsState;
use tempfile::{NamedTempFile, PersistError};

const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_INVALID_MESSAGE: &str =
    "Jukebox could not read settings because the file is invalid. Defaults are active until you save them.";
const SETTINGS_UNREADABLE_MESSAGE: &str =
    "Jukebox could not read settings. Defaults are active until you save them.";
const SETTINGS_SAVE_ERROR_MESSAGE: &str =
    "Jukebox could not save settings. Your previous settings are still available.";
const SETTINGS_STATE_ERROR_MESSAGE: &str = "Jukebox settings are temporarily unavailable.";

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub close_on_x: bool,
    pub music_folder: String,
    pub remote_access_enabled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingsWarningCode {
    InvalidJson,
    Unreadable,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsWarning {
    pub code: SettingsWarningCode,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub settings: AppSettings,
    pub warning: Option<SettingsWarning>,
}

pub struct AppState {
    pub settings: RwLock<AppSettings>,
    pub settings_warning: RwLock<Option<SettingsWarning>>,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(SETTINGS_FILE))
        .map_err(|error| error.to_string())
}

fn warning_snapshot(code: SettingsWarningCode, message: &str) -> SettingsSnapshot {
    SettingsSnapshot {
        settings: AppSettings::default(),
        warning: Some(SettingsWarning {
            code,
            message: message.to_owned(),
        }),
    }
}

fn load_settings_from_path(path: &Path) -> SettingsSnapshot {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SettingsSnapshot::default()
        }
        Err(_) => {
            return warning_snapshot(SettingsWarningCode::Unreadable, SETTINGS_UNREADABLE_MESSAGE)
        }
    };

    match serde_json::from_str(&contents) {
        Ok(settings) => SettingsSnapshot {
            settings,
            warning: None,
        },
        Err(_) => warning_snapshot(SettingsWarningCode::InvalidJson, SETTINGS_INVALID_MESSAGE),
    }
}

pub fn load_settings(app: &tauri::AppHandle) -> SettingsSnapshot {
    match settings_path(app) {
        Ok(path) => load_settings_from_path(&path),
        Err(_) => warning_snapshot(SettingsWarningCode::Unreadable, SETTINGS_UNREADABLE_MESSAGE),
    }
}

pub fn should_start_remote_access(snapshot: &SettingsSnapshot) -> bool {
    snapshot.warning.is_none() && snapshot.settings.remote_access_enabled
}

fn save_settings_to_path_with<P>(
    path: &Path,
    settings: &AppSettings,
    persist: P,
) -> Result<(), String>
where
    P: FnOnce(NamedTempFile, &Path) -> Result<File, PersistError>,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| SETTINGS_SAVE_ERROR_MESSAGE.to_owned())?;
    }

    let parent = path
        .parent()
        .ok_or_else(|| SETTINGS_SAVE_ERROR_MESSAGE.to_owned())?;
    let contents =
        serde_json::to_vec_pretty(settings).map_err(|_| SETTINGS_SAVE_ERROR_MESSAGE.to_owned())?;
    let mut temporary =
        NamedTempFile::new_in(parent).map_err(|_| SETTINGS_SAVE_ERROR_MESSAGE.to_owned())?;
    temporary
        .write_all(&contents)
        .map_err(|_| SETTINGS_SAVE_ERROR_MESSAGE.to_owned())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| SETTINGS_SAVE_ERROR_MESSAGE.to_owned())?;
    persist(temporary, path).map_err(|_| SETTINGS_SAVE_ERROR_MESSAGE.to_owned())?;
    Ok(())
}

fn save_settings_to_path(path: &Path, settings: &AppSettings) -> Result<(), String> {
    save_settings_to_path_with(path, settings, |temporary, destination| {
        temporary.persist(destination)
    })
}

pub(crate) fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app).map_err(|_| SETTINGS_SAVE_ERROR_MESSAGE.to_owned())?;
    save_settings_to_path(&path, settings)
}

fn update_settings_state(
    state: &AppState,
    settings: AppSettings,
) -> Result<SettingsSnapshot, String> {
    let mut current = state
        .settings
        .write()
        .map_err(|_| SETTINGS_STATE_ERROR_MESSAGE.to_owned())?;
    let mut warning = state
        .settings_warning
        .write()
        .map_err(|_| SETTINGS_STATE_ERROR_MESSAGE.to_owned())?;
    *current = settings.clone();
    *warning = None;
    Ok(SettingsSnapshot {
        settings,
        warning: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_settings_use_defaults_without_a_warning() {
        let directory = tempfile::tempdir().expect("create temp directory");

        assert_eq!(
            load_settings_from_path(&directory.path().join(SETTINGS_FILE)),
            SettingsSnapshot::default()
        );
    }

    #[test]
    fn current_settings_load_without_a_warning() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join(SETTINGS_FILE);
        fs::write(
            &path,
            r#"{"closeOnX":true,"musicFolder":"/Music","remoteAccessEnabled":true}"#,
        )
        .expect("write settings");

        let snapshot = load_settings_from_path(&path);

        assert_eq!(
            snapshot.settings,
            AppSettings {
                close_on_x: true,
                music_folder: "/Music".to_owned(),
                remote_access_enabled: true,
            }
        );
        assert_eq!(snapshot.warning, None);
    }

    #[test]
    fn older_settings_default_new_fields() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join(SETTINGS_FILE);
        fs::write(&path, r#"{"closeOnX":true,"musicFolder":"/Music"}"#).expect("write settings");

        let snapshot = load_settings_from_path(&path);

        assert!(snapshot.settings.close_on_x);
        assert_eq!(snapshot.settings.music_folder, "/Music");
        assert!(!snapshot.settings.remote_access_enabled);
        assert_eq!(snapshot.warning, None);
    }

    #[test]
    fn malformed_settings_return_a_typed_warning_and_preserve_the_file() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join(SETTINGS_FILE);
        let malformed = r#"{"musicFolder": "unfinished"#;
        fs::write(&path, malformed).expect("write malformed settings");

        let snapshot = load_settings_from_path(&path);

        assert_eq!(snapshot.settings, AppSettings::default());
        assert_eq!(
            snapshot.warning.map(|warning| warning.code),
            Some(SettingsWarningCode::InvalidJson)
        );
        assert_eq!(fs::read_to_string(path).expect("read original"), malformed);
    }

    #[test]
    fn unreadable_settings_return_a_typed_warning() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join(SETTINGS_FILE);
        fs::create_dir(&path).expect("create unreadable settings path");

        let snapshot = load_settings_from_path(&path);

        assert_eq!(snapshot.settings, AppSettings::default());
        assert_eq!(
            snapshot.warning.map(|warning| warning.code),
            Some(SettingsWarningCode::Unreadable)
        );
        assert!(path.is_dir());
    }

    #[test]
    fn atomic_save_replaces_existing_settings() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join(SETTINGS_FILE);
        let old_settings = AppSettings {
            music_folder: "/Old".to_owned(),
            ..AppSettings::default()
        };
        let new_settings = AppSettings {
            close_on_x: true,
            music_folder: "/New".to_owned(),
            remote_access_enabled: true,
        };
        save_settings_to_path(&path, &old_settings).expect("save old settings");

        save_settings_to_path(&path, &new_settings).expect("replace settings");

        assert_eq!(load_settings_from_path(&path).settings, new_settings);
        assert_eq!(
            fs::read_dir(directory.path())
                .expect("list directory")
                .count(),
            1
        );
    }

    #[test]
    fn failed_atomic_replace_keeps_previous_settings_and_cleans_the_temporary_file() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join(SETTINGS_FILE);
        let failed_target = directory.path().join("cannot-replace-directory");
        fs::create_dir(&failed_target).expect("create failed persist target");
        let old_settings = AppSettings {
            music_folder: "/Old".to_owned(),
            ..AppSettings::default()
        };
        let new_settings = AppSettings {
            music_folder: "/New".to_owned(),
            ..AppSettings::default()
        };
        save_settings_to_path(&path, &old_settings).expect("save old settings");

        let result = save_settings_to_path_with(&path, &new_settings, |temporary, _| {
            temporary.persist(&failed_target)
        });

        assert_eq!(result, Err(SETTINGS_SAVE_ERROR_MESSAGE.to_owned()));
        assert_eq!(load_settings_from_path(&path).settings, old_settings);
        assert_eq!(
            fs::read_dir(directory.path())
                .expect("list directory")
                .count(),
            2
        );
    }

    #[test]
    fn settings_warning_prevents_automatic_remote_access_start() {
        let snapshot = SettingsSnapshot {
            settings: AppSettings {
                remote_access_enabled: true,
                ..AppSettings::default()
            },
            warning: Some(SettingsWarning {
                code: SettingsWarningCode::Unreadable,
                message: SETTINGS_UNREADABLE_MESSAGE.to_owned(),
            }),
        };

        assert!(!should_start_remote_access(&snapshot));
        assert!(should_start_remote_access(&SettingsSnapshot {
            warning: None,
            ..snapshot
        }));
    }

    #[test]
    fn warning_clears_only_after_atomic_persistence_succeeds() {
        let directory = tempfile::tempdir().expect("create temp directory");
        let path = directory.path().join(SETTINGS_FILE);
        let failed_target = directory.path().join("cannot-replace-directory");
        fs::create_dir(&failed_target).expect("create failed persist target");
        let old_settings = AppSettings {
            music_folder: "/Old".to_owned(),
            ..AppSettings::default()
        };
        let new_settings = AppSettings {
            music_folder: "/New".to_owned(),
            ..AppSettings::default()
        };
        save_settings_to_path(&path, &old_settings).expect("save old settings");
        let state = AppState {
            settings: RwLock::new(old_settings.clone()),
            settings_warning: RwLock::new(Some(SettingsWarning {
                code: SettingsWarningCode::InvalidJson,
                message: SETTINGS_INVALID_MESSAGE.to_owned(),
            })),
        };

        let failed = save_settings_to_path_with(&path, &new_settings, |temporary, _| {
            temporary.persist(&failed_target)
        });
        assert!(failed.is_err());
        assert_eq!(
            state.settings.read().expect("read settings").clone(),
            old_settings
        );
        assert!(state
            .settings_warning
            .read()
            .expect("read warning")
            .is_some());

        save_settings_to_path(&path, &new_settings).expect("save new settings");
        let snapshot = update_settings_state(&state, new_settings.clone()).expect("update state");
        assert_eq!(snapshot.settings, new_settings);
        assert_eq!(snapshot.warning, None);
        assert!(state
            .settings_warning
            .read()
            .expect("read warning")
            .is_none());
    }
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, AppState>) -> Result<SettingsSnapshot, String> {
    let settings = state
        .settings
        .read()
        .map(|settings| settings.clone())
        .map_err(|_| SETTINGS_STATE_ERROR_MESSAGE.to_owned())?;
    let warning = state
        .settings_warning
        .read()
        .map(|warning| warning.clone())
        .map_err(|_| SETTINGS_STATE_ERROR_MESSAGE.to_owned())?;
    Ok(SettingsSnapshot { settings, warning })
}

#[tauri::command]
pub fn set_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    settings: AppSettings,
) -> Result<SettingsSnapshot, String> {
    let diagnostics = app.state::<DiagnosticsState>().inner().clone();
    if let Err(error) = save_settings(&app, &settings) {
        diagnostics.record_error(
            "settings",
            "save_failed",
            "previous_settings_preserved=true",
        );
        return Err(error);
    }
    update_settings_state(&state, settings).inspect_err(|_| {
        diagnostics.record_error("settings", "state_update_failed", "persisted=true");
    })
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use crate::metadata::Metadata;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::command;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, WindowEvent};

mod metadata;

const MAIN_WINDOW: &str = "main";
const TRAY_SHOW: &str = "tray_show";
const TRAY_HIDE: &str = "tray_hide";
const TRAY_QUIT: &str = "tray_quit";

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AppSettings {
    close_on_x: bool,
    music_folder: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            close_on_x: false,
            music_folder: String::new(),
        }
    }
}

struct AppState {
    settings: Mutex<AppSettings>,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|e| e.to_string())
}

fn load_settings(app: &tauri::AppHandle) -> AppSettings {
    let path = match settings_path(app) {
        Ok(path) => path,
        Err(_) => return AppSettings::default(),
    };

    let Ok(data) = fs::read_to_string(path) else {
        return AppSettings::default();
    };

    serde_json::from_str(&data).unwrap_or_default()
}

fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[command]
fn get_metadata(app_handle: tauri::AppHandle, file_path: String) -> String {
    let song_metadata = Metadata::new(&app_handle, file_path);
    serde_json::to_string(&song_metadata).unwrap_or_else(|_| "{}".to_string())
}

#[command]
fn get_settings(app_handle: tauri::AppHandle, state: tauri::State<AppState>) -> AppSettings {
    let settings = state.settings.lock().map(|s| s.clone()).unwrap_or_default();
    if settings.music_folder.is_empty() {
        let _ = save_settings(&app_handle, &settings);
    }
    settings
}

#[command]
fn set_settings(
    app_handle: tauri::AppHandle,
    state: tauri::State<AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    if let Ok(mut current) = state.settings.lock() {
        *current = settings.clone();
    }
    save_settings(&app_handle, &settings)?;
    Ok(settings)
}

fn with_main_window<F: FnOnce(&tauri::WebviewWindow)>(app: &tauri::AppHandle, f: F) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        f(&window);
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let settings = load_settings(&app.handle());
            app.manage(AppState {
                settings: Mutex::new(settings),
            });

            let show = MenuItemBuilder::new("Show").id(TRAY_SHOW).build(app)?;
            let hide = MenuItemBuilder::new("Hide").id(TRAY_HIDE).build(app)?;
            let quit = MenuItemBuilder::new("Quit").id(TRAY_QUIT).build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &hide, &PredefinedMenuItem::separator(app)?, &quit])
                .build()?;

            let mut tray_builder =
                TrayIconBuilder::new()
                    .menu(&menu)
                    .tooltip("Jukebox")
                    .on_menu_event(|app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                        match event.id().as_ref() {
                            TRAY_SHOW => {
                                with_main_window(app, |window| {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                });
                            }
                            TRAY_HIDE => {
                                with_main_window(app, |window| {
                                    let _ = window.hide();
                                });
                            }
                            TRAY_QUIT => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let app_handle = window.app_handle();
                    let close_on_x = app_handle
                        .state::<AppState>()
                        .settings
                        .lock()
                        .map(|settings| settings.close_on_x)
                        .unwrap_or(false);

                    if !close_on_x {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_metadata,
            get_settings,
            set_settings
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            with_main_window(app_handle, |window| {
                let _ = window.show();
                let _ = window.set_focus();
            });
        }
    });
}

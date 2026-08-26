#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use crate::metadata::Metadata;
use crate::remote_access::{
    get_remote_access_status, set_remote_access_enabled, RemoteAccessState,
};
use crate::settings::{get_settings, load_settings, set_settings, AppState};
use crate::tailscale::get_tailscale_status;
use std::sync::RwLock;
use tauri::command;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{Manager, WindowEvent};

mod database;
mod metadata;
mod remote_access;
mod settings;
mod tailscale;

const MAIN_WINDOW: &str = "main";
const TRAY_SHOW: &str = "tray_show";
const TRAY_HIDE: &str = "tray_hide";
const TRAY_QUIT: &str = "tray_quit";

#[command]
async fn get_metadata(app_handle: tauri::AppHandle, file_path: String) -> Result<Metadata, String> {
    tauri::async_runtime::spawn_blocking(move || Metadata::new(&app_handle, file_path))
        .await
        .map_err(|error| error.to_string())?
}

fn with_main_window<F: FnOnce(&tauri::WebviewWindow)>(app: &tauri::AppHandle, f: F) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        f(&window);
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let settings = load_settings(app.handle());
            let start_remote_access = settings.remote_access_enabled;
            app.manage(AppState {
                settings: RwLock::new(settings),
            });

            let remote_access = RemoteAccessState::default();
            app.manage(remote_access.clone());
            if start_remote_access {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = remote_access.start(app_handle).await {
                        eprintln!("remote access failed to start: {error}");
                    }
                });
            }

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
                    let close_on_x = window
                        .state::<AppState>()
                        .settings
                        .read()
                        .map(|settings| settings.close_on_x)
                        .unwrap_or(false);

                    if close_on_x {
                        window.app_handle().exit(0);
                    } else {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_metadata,
            get_settings,
            set_settings,
            get_remote_access_status,
            set_remote_access_enabled,
            get_tailscale_status
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(database::LIBRARY_DB_URL, database::migrations())
                .build(),
        )
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    #[cfg(target_os = "macos")]
    app.run(|app_handle, event| {
        if let RunEvent::Reopen { .. } = event {
            with_main_window(app_handle, |window| {
                let _ = window.show();
                let _ = window.set_focus();
            });
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
}

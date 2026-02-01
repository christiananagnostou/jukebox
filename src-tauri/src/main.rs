#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use crate::metadata::Metadata;
use tauri::command;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, WindowEvent};

mod metadata;

const MAIN_WINDOW: &str = "main";
const TRAY_SHOW: &str = "tray_show";
const TRAY_HIDE: &str = "tray_hide";
const TRAY_QUIT: &str = "tray_quit";

#[command]
fn get_metadata(app_handle: tauri::AppHandle, file_path: String) -> String {
    let song_metadata = Metadata::new(&app_handle, file_path);
    serde_json::to_string(&song_metadata).unwrap_or_else(|_| "{}".to_string())
}

fn with_main_window<F: FnOnce(&tauri::WebviewWindow)>(app: &tauri::AppHandle, f: F) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        f(&window);
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
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
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_metadata])
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

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use crate::metadata::Metadata;
use tauri::command;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WindowEvent};

mod metadata;

#[command]
fn get_metadata(app_handle: tauri::AppHandle, file_path: String) -> String {
    let song_metadata = Metadata::new(&app_handle, file_path);
    serde_json::to_string(&song_metadata).unwrap()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let show = MenuItemBuilder::new("Show").id("tray_show").build(app)?;
            let hide = MenuItemBuilder::new("Hide").id("tray_hide").build(app)?;
            let quit = MenuItemBuilder::new("Quit").id("tray_quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &hide, &PredefinedMenuItem::separator(app)?, &quit])
                .build()?;

            let mut tray_builder =
                TrayIconBuilder::new()
                    .menu(&menu)
                    .tooltip("Jukebox")
                    .on_menu_event(|app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                        match event.id().as_ref() {
                            "tray_show" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                            "tray_hide" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.hide();
                                }
                            }
                            "tray_quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: TrayIconEvent| {
                        if matches!(
                            event,
                            TrayIconEvent::Click { .. } | TrayIconEvent::DoubleClick { .. }
                        ) {
                            if let Some(window) = tray.app_handle().get_webview_window("main") {
                                if window.is_visible().unwrap_or(true) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
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
        .run(tauri::generate_context!(), |app, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .expect("error while running tauri application");
}

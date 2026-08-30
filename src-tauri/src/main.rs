#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use crate::catalog_mutations::{
    clear_library_songs, delete_songs, update_favorite_rating, upsert_songs,
};
use crate::diagnostics::{
    copy_diagnostics_summary, get_diagnostics_summary, open_diagnostics_directory,
    record_playback_client_event, DiagnosticsState,
};
use crate::import_paths::{classify_import_paths, pick_import_directories};
use crate::library::{
    add_library_root, add_playlist_entries, apply_library_reconciliation,
    cancel_library_reconciliation, cancel_library_refresh, cancel_library_scan, create_playlist,
    delete_playlist, get_library_reconciliation, get_library_refresh, get_library_scan,
    list_library_refreshes, list_library_roots, list_playlist_entries, list_playlists,
    prepare_library_scan, query_albums, query_artists, query_built_in_collection, query_facets,
    query_storage, query_tracks, remove_playlist_entries, rename_playlist, resolve_playback_tracks,
    set_library_root_enabled, start_library_refresh, start_library_scan, LibraryState,
};
use crate::metadata::Metadata;
use crate::playback::{
    clear_play_history, dispatch_playback_command, get_playback_snapshot, list_play_history,
    observe_playback_position, PlaybackState,
};
use crate::playback_assets::{authorize_playback_asset, PlaybackAssetServer};
use crate::remote_access::{
    get_remote_access_status, set_remote_access_enabled, RemoteAccessState,
};
use crate::settings::{
    get_settings, load_settings, set_settings, should_start_remote_access, AppState,
    SettingsWarningCode,
};
use crate::tailscale::{get_tailscale_status, start_tailscale_serve, stop_tailscale_serve};
use std::sync::RwLock;
use tauri::command;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::RunEvent;
use tauri::{Manager, WindowEvent};

mod artwork;
mod catalog_mutations;
mod database;
mod diagnostics;
mod import_paths;
mod library;
mod metadata;
mod playback;
mod playback_assets;
mod remote_access;
mod settings;
mod tailscale;

const MAIN_WINDOW: &str = "main";
const TRAY_SHOW: &str = "tray_show";
const TRAY_HIDE: &str = "tray_hide";
const TRAY_QUIT: &str = "tray_quit";

#[command]
async fn get_metadata(app_handle: tauri::AppHandle, file_path: String) -> Result<Metadata, String> {
    let diagnostics = app_handle.state::<DiagnosticsState>().inner().clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || Metadata::new(&app_handle, file_path))
            .await
            .map_err(|_| "Jukebox could not read that audio file.".to_owned())?;
    if result.is_err() {
        diagnostics.record_error("metadata", "read_failed", "");
    }
    result
}

fn with_main_window<F: FnOnce(&tauri::WebviewWindow)>(app: &tauri::AppHandle, f: F) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        f(&window);
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let schema_version = database::LATEST_SCHEMA_VERSION;
            let diagnostics = DiagnosticsState::new(app.handle(), schema_version);
            diagnostics.record_info(
                "application",
                "startup",
                &format!("schema_version={schema_version}"),
            );
            app.manage(diagnostics.clone());

            let settings_snapshot = load_settings(app.handle());
            if let Some(warning) = &settings_snapshot.warning {
                let code = match warning.code {
                    SettingsWarningCode::InvalidJson => "invalid_json",
                    SettingsWarningCode::Unreadable => "unreadable",
                };
                diagnostics.record_error("settings", code, "defaults_active=true");
            }
            let start_remote_access = should_start_remote_access(&settings_snapshot);
            app.manage(AppState {
                settings: RwLock::new(settings_snapshot.settings),
                settings_warning: RwLock::new(settings_snapshot.warning),
            });
            let library = LibraryState::new(app.handle()).map_err(|error| {
                diagnostics.record_error("library", "initialization_failed", "");
                std::io::Error::other(error)
            })?;
            app.manage(library.clone());
            let playback_server = tauri::async_runtime::block_on(PlaybackAssetServer::start(
                library.pool(),
                diagnostics.clone(),
            ))
            .map_err(std::io::Error::other)?;
            app.manage(playback_server);
            app.manage(PlaybackState::new(library.pool()));
            let watcher_app = app.handle().clone();
            let watcher_diagnostics = diagnostics.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = library.recover_library_watchers(watcher_app).await {
                    watcher_diagnostics.record_error(
                        "library_watcher",
                        &error.code,
                        "phase=startup",
                    );
                }
            });

            let remote_access = RemoteAccessState::default();
            app.manage(remote_access.clone());
            if start_remote_access {
                let app_handle = app.handle().clone();
                let remote_diagnostics = diagnostics.clone();
                tauri::async_runtime::spawn(async move {
                    if remote_access.start(app_handle).await.is_err() {
                        remote_diagnostics.record_error("remote_access", "startup_failed", "");
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
            upsert_songs,
            delete_songs,
            clear_library_songs,
            update_favorite_rating,
            query_tracks,
            query_built_in_collection,
            query_facets,
            create_playlist,
            list_playlists,
            rename_playlist,
            delete_playlist,
            add_playlist_entries,
            list_playlist_entries,
            remove_playlist_entries,
            resolve_playback_tracks,
            query_artists,
            query_albums,
            query_storage,
            add_library_root,
            list_library_roots,
            set_library_root_enabled,
            start_library_scan,
            cancel_library_scan,
            get_library_scan,
            prepare_library_scan,
            cancel_library_reconciliation,
            get_library_reconciliation,
            apply_library_reconciliation,
            start_library_refresh,
            cancel_library_refresh,
            get_library_refresh,
            list_library_refreshes,
            get_metadata,
            classify_import_paths,
            pick_import_directories,
            copy_diagnostics_summary,
            get_diagnostics_summary,
            open_diagnostics_directory,
            record_playback_client_event,
            authorize_playback_asset,
            get_playback_snapshot,
            dispatch_playback_command,
            observe_playback_position,
            list_play_history,
            clear_play_history,
            get_settings,
            set_settings,
            get_remote_access_status,
            set_remote_access_enabled,
            get_tailscale_status,
            start_tailscale_serve,
            stop_tailscale_serve
        ])
        .plugin(tauri_plugin_dialog::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if matches!(event, RunEvent::Reopen { .. }) {
            with_main_window(app_handle, |window| {
                let _ = window.show();
                let _ = window.set_focus();
            });
        }

        if matches!(event, RunEvent::Resumed) {
            let library = app_handle.state::<LibraryState>().inner().clone();
            let diagnostics = app_handle.state::<DiagnosticsState>().inner().clone();
            let watcher_app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = library.recover_library_watchers(watcher_app).await {
                    diagnostics.record_error("library_watcher", &error.code, "phase=resume");
                }
            });
        }
    });
}

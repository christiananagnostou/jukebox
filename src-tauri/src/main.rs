// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;
use crate::metadata::Metadata;

mod metadata;

#[command]
fn get_metadata(song_path: String) -> String {
    let song_metadata = Metadata::build(song_path);
    let song_metadata_json = serde_json::to_string(&song_metadata).unwrap();

    song_metadata_json
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use crate::metadata::Metadata;
use tauri::command;

mod metadata;

#[command]
fn get_metadata(file_path: String) -> String {
    let song_metadata = Metadata::new(file_path);
    serde_json::to_string(&song_metadata).unwrap()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_metadata])
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

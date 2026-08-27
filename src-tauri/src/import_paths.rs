use serde::Serialize;
use std::path::Path;

const MAX_SELECTED_PATHS: usize = 4_096;
const MAX_PATH_BYTES: usize = 32_768;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPathPartition {
    directories: Vec<String>,
    files: Vec<String>,
}

fn classify_paths(paths: Vec<String>) -> Result<ImportPathPartition, String> {
    if paths.len() > MAX_SELECTED_PATHS {
        return Err("Too many paths were selected at once.".to_owned());
    }

    let mut directories = Vec::new();
    let mut files = Vec::new();
    for path in paths {
        if path.is_empty() || path.len() > MAX_PATH_BYTES || path.contains('\0') {
            return Err("One of the selected paths is invalid.".to_owned());
        }
        let metadata = std::fs::metadata(Path::new(&path))
            .map_err(|_| "Jukebox could not inspect one of the selected paths.".to_owned())?;
        if metadata.is_dir() {
            directories.push(path);
        } else if metadata.is_file() {
            files.push(path);
        }
    }

    Ok(ImportPathPartition { directories, files })
}

#[tauri::command]
pub async fn classify_import_paths(paths: Vec<String>) -> Result<ImportPathPartition, String> {
    tauri::async_runtime::spawn_blocking(move || classify_paths(paths))
        .await
        .map_err(|_| "Jukebox could not inspect the selected paths.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn classifies_files_and_directories_without_returning_metadata() {
        let directory = tempfile::tempdir().expect("create import directory");
        let nested = directory.path().join("library");
        let file = directory.path().join("track.flac");
        fs::create_dir(&nested).expect("create nested directory");
        fs::write(&file, b"fixture").expect("create file");

        let result = classify_paths(vec![
            nested.to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
        ])
        .expect("classify import paths");

        assert_eq!(result.directories, vec![nested.to_string_lossy()]);
        assert_eq!(result.files, vec![file.to_string_lossy()]);
    }

    #[test]
    fn rejects_missing_invalid_and_oversized_path_sets_without_echoing_paths() {
        let directory = tempfile::tempdir().expect("create missing-path directory");
        let missing = directory
            .path()
            .join("missing-audio.flac")
            .to_string_lossy()
            .into_owned();
        let error = classify_paths(vec![missing.clone()]).expect_err("reject missing path");
        assert!(!error.contains(&missing));
        assert!(classify_paths(vec![String::new()]).is_err());
        assert!(classify_paths(vec!["x".repeat(MAX_PATH_BYTES + 1)]).is_err());
        assert!(classify_paths(vec!["x".to_owned(); MAX_SELECTED_PATHS + 1]).is_err());
    }
}

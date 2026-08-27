use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_ARTWORK_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct ArtworkCache {
    root: PathBuf,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct CollectionReport {
    pub files_removed: usize,
    pub bytes_removed: u64,
}

impl ArtworkCache {
    pub(crate) fn from_app(app: &tauri::AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|_| "Could not resolve the Jukebox artwork directory.".to_owned())?
            .join("Jukebox")
            .join("art");
        Ok(Self { root })
    }

    #[cfg(test)]
    pub(crate) fn from_root(root: PathBuf) -> Self {
        Self { root }
    }

    pub(crate) fn cache(&self, media_type: &str, data: &[u8]) -> Result<Option<PathBuf>, String> {
        if data.is_empty() || data.len() > MAX_ARTWORK_BYTES {
            return Ok(None);
        }

        let digest = format!("{:x}", Sha256::digest(data));
        let extension = safe_extension(media_type);
        let directory = self.root.join(&digest[..2]);
        let path = directory.join(format!("{digest}.{extension}"));
        fs::create_dir_all(&directory)
            .map_err(|_| "Could not prepare the Jukebox artwork cache.".to_owned())?;

        if regular_file_exists(&path)? {
            return Ok(Some(path));
        }

        let mut temporary = tempfile::NamedTempFile::new_in(&directory)
            .map_err(|_| "Could not prepare a temporary artwork file.".to_owned())?;
        temporary
            .write_all(data)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|_| "Could not write cached artwork.".to_owned())?;
        match temporary.persist_noclobber(&path) {
            Ok(file) => file
                .sync_all()
                .map_err(|_| "Could not finish caching artwork.".to_owned())?,
            Err(error)
                if error.error.kind() == std::io::ErrorKind::AlreadyExists
                    && regular_file_exists(&path)? => {}
            Err(_) => return Err("Could not publish cached artwork.".to_owned()),
        }

        Ok(Some(path))
    }

    pub(crate) async fn collect(&self, pool: &SqlitePool) -> Result<CollectionReport, String> {
        let referenced = sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT visualsPath FROM songs WHERE visualsPath <> ''",
        )
        .fetch_all(pool)
        .await
        .map_err(|_| "Could not inspect artwork references.".to_owned())?
        .into_iter()
        .map(PathBuf::from)
        .collect::<HashSet<_>>();
        let root = self.root.clone();

        tokio::task::spawn_blocking(move || collect_unreferenced(&root, &referenced))
            .await
            .map_err(|_| "Artwork collection stopped unexpectedly.".to_owned())?
    }
}

fn safe_extension(media_type: &str) -> &str {
    media_type
        .rsplit('/')
        .next()
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 12
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
        .unwrap_or("bin")
}

fn regular_file_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(true),
        Ok(_) => Err("The artwork cache path is not a regular file.".to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("Could not inspect the artwork cache.".to_owned()),
    }
}

fn collect_unreferenced(
    root: &Path,
    referenced: &HashSet<PathBuf>,
) -> Result<CollectionReport, String> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CollectionReport::default())
        }
        Err(_) => return Err("Could not inspect the artwork cache.".to_owned()),
    };
    if !metadata.file_type().is_dir() {
        return Err("The artwork cache path is not a directory.".to_owned());
    }

    let mut report = CollectionReport::default();
    collect_directory(root, root, referenced, &mut report)?;
    Ok(report)
}

fn collect_directory(
    root: &Path,
    directory: &Path,
    referenced: &HashSet<PathBuf>,
    report: &mut CollectionReport,
) -> Result<(), String> {
    for entry in
        fs::read_dir(directory).map_err(|_| "Could not read the artwork cache.".to_owned())?
    {
        let entry = entry.map_err(|_| "Could not read an artwork cache entry.".to_owned())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "Could not inspect an artwork cache entry.".to_owned())?;
        let path = entry.path();
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_directory(root, &path, referenced, report)?;
            if fs::read_dir(&path)
                .map_err(|_| "Could not inspect an artwork cache directory.".to_owned())?
                .next()
                .is_none()
            {
                fs::remove_dir(&path)
                    .map_err(|_| "Could not remove an empty artwork cache directory.".to_owned())?;
            }
            continue;
        }
        if file_type.is_file() && !referenced.contains(&path) {
            let bytes = entry
                .metadata()
                .map(|value| value.len())
                .unwrap_or_default();
            fs::remove_file(&path)
                .map_err(|_| "Could not remove unreferenced artwork.".to_owned())?;
            report.files_removed += 1;
            report.bytes_removed = report.bytes_removed.saturating_add(bytes);
        }
    }

    debug_assert!(directory.starts_with(root));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn cache_deduplicates_bytes_and_skips_oversized_images() {
        let directory = tempfile::tempdir().expect("create artwork fixture");
        let cache = ArtworkCache::from_root(directory.path().join("art"));
        let first = cache
            .cache("image/jpeg", b"shared cover")
            .expect("cache first image")
            .expect("image path");
        let second = cache
            .cache("image/jpeg", b"shared cover")
            .expect("cache duplicate image")
            .expect("image path");

        assert_eq!(first, second);
        assert_eq!(
            fs::read(&first).expect("read cached image"),
            b"shared cover"
        );
        assert!(cache
            .cache("image/png", &vec![0; MAX_ARTWORK_BYTES + 1])
            .expect("skip oversized image")
            .is_none());
    }

    #[test]
    fn collection_preserves_references_and_skips_symlinks() {
        run_async(async {
            let directory = tempfile::tempdir().expect("create collection fixture");
            let root = directory.path().join("art");
            let cache = ArtworkCache::from_root(root.clone());
            let referenced = cache
                .cache("image/png", b"referenced")
                .expect("cache referenced image")
                .expect("referenced path");
            let abandoned = cache
                .cache("image/png", b"abandoned")
                .expect("cache abandoned image")
                .expect("abandoned path");

            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open fixture database");
            sqlx::raw_sql(crate::database::INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("create songs table");
            sqlx::query(
                "INSERT INTO songs VALUES
                 ('song', '/music/song.flac', 'song.flac', 'Song', '', '', '', 0, 0, '', '',
                  0, 0, 'flac', '', '', 0, 0, 0, '', ?)",
            )
            .bind(referenced.to_string_lossy().as_ref())
            .execute(&pool)
            .await
            .expect("reference cached artwork");

            #[cfg(unix)]
            let link = {
                let outside = directory.path().join("outside");
                fs::write(&outside, b"outside").expect("write outside fixture");
                let link = root.join("outside-link");
                std::os::unix::fs::symlink(&outside, &link).expect("link outside fixture");
                Some((link, outside))
            };

            let report = cache.collect(&pool).await.expect("collect artwork");
            assert_eq!(report.files_removed, 1);
            assert_eq!(report.bytes_removed, b"abandoned".len() as u64);
            assert!(referenced.is_file());
            assert!(!abandoned.exists());
            #[cfg(unix)]
            if let Some((link, outside)) = link {
                assert!(link.symlink_metadata().is_ok());
                assert_eq!(fs::read(outside).expect("read outside fixture"), b"outside");
            }

            pool.close().await;
        });
    }
}

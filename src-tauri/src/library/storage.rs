use super::query::{validate_relative_path, LibraryError, SortDirection, MAX_PAGE_SIZE};
use super::repository::fts_expression;
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::path::Path;

const IMPORTED_ROOT_ID: i64 = 0;
const REBUILD_STORAGE_INDEX_SQL: &str = r#"
WITH RECURSIVE path_nodes (
  root_id, song_id, remainder, parent_path, name, relative_path, kind
) AS (
  SELECT
    root_id,
    id,
    normalized_path,
    '',
    CASE WHEN instr(normalized_path, '/') > 0
         THEN substr(normalized_path, 1, instr(normalized_path, '/') - 1)
         ELSE normalized_path END,
    CASE WHEN instr(normalized_path, '/') > 0
         THEN substr(normalized_path, 1, instr(normalized_path, '/') - 1)
         ELSE normalized_path END,
    CASE WHEN instr(normalized_path, '/') > 0 THEN 'directory' ELSE 'track' END
  FROM songs
  WHERE root_id = ? AND normalized_path IS NOT NULL AND availability = 'available'

  UNION ALL

  SELECT
    root_id,
    song_id,
    substr(remainder, instr(remainder, '/') + 1),
    relative_path,
    CASE
      WHEN instr(substr(remainder, instr(remainder, '/') + 1), '/') > 0
      THEN substr(
        substr(remainder, instr(remainder, '/') + 1),
        1,
        instr(substr(remainder, instr(remainder, '/') + 1), '/') - 1
      )
      ELSE substr(remainder, instr(remainder, '/') + 1)
    END,
    relative_path || '/' || CASE
      WHEN instr(substr(remainder, instr(remainder, '/') + 1), '/') > 0
      THEN substr(
        substr(remainder, instr(remainder, '/') + 1),
        1,
        instr(substr(remainder, instr(remainder, '/') + 1), '/') - 1
      )
      ELSE substr(remainder, instr(remainder, '/') + 1)
    END,
    CASE WHEN instr(substr(remainder, instr(remainder, '/') + 1), '/') > 0
         THEN 'directory' ELSE 'track' END
  FROM path_nodes
  WHERE instr(remainder, '/') > 0
)
INSERT INTO library_storage_nodes (
  root_id, relative_path, parent_path, name, kind, song_id, track_count
)
SELECT
  root_id,
  relative_path,
  parent_path,
  name,
  kind,
  CASE WHEN kind = 'track' THEN MIN(song_id) END,
  COUNT(*)
FROM path_nodes
GROUP BY root_id, relative_path, parent_path, name, kind
"#;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StorageQuery {
    pub direction: SortDirection,
    pub limit: u32,
    pub offset: u32,
    pub parent: String,
    pub q: String,
    pub root_id: Option<i64>,
}

impl Default for StorageQuery {
    fn default() -> Self {
        Self {
            direction: SortDirection::Asc,
            limit: 50,
            offset: 0,
            parent: String::new(),
            q: String::new(),
            root_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageNodeKind {
    Directory,
    Root,
    Track,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageNode {
    pub display_path: String,
    pub kind: StorageNodeKind,
    pub name: String,
    pub relative_path: String,
    pub root_id: i64,
    pub song_id: Option<String>,
    pub track_count: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePage {
    pub items: Vec<StorageNode>,
    pub revision: i64,
    pub total: i64,
}

#[derive(Debug)]
struct NormalizedStorageQuery {
    direction: SortDirection,
    limit: u32,
    offset: u32,
    parent: String,
    q: String,
    root_id: Option<i64>,
}

impl StorageQuery {
    fn normalize(self) -> Result<NormalizedStorageQuery, LibraryError> {
        if self.limit == 0 {
            return Err(LibraryError::invalid_query(
                "Storage page size must be at least one.",
            ));
        }
        if self.root_id.is_none() && !self.parent.is_empty() {
            return Err(LibraryError::invalid_query(
                "A storage parent requires a library root.",
            ));
        }
        if self
            .root_id
            .is_some_and(|root_id| root_id < IMPORTED_ROOT_ID)
        {
            return Err(LibraryError::invalid_query(
                "Library root identifiers cannot be negative.",
            ));
        }
        if self.root_id == Some(IMPORTED_ROOT_ID) && !self.parent.is_empty() {
            return Err(LibraryError::invalid_query(
                "Imported tracks do not have nested storage folders.",
            ));
        }
        if !self.parent.is_empty() {
            validate_relative_path(&self.parent)?;
        }
        let q = self.q.trim().to_owned();
        if q.chars().count() > 256 {
            return Err(LibraryError::invalid_query("Storage search is too long."));
        }
        Ok(NormalizedStorageQuery {
            direction: self.direction,
            limit: self.limit.min(MAX_PAGE_SIZE),
            offset: self.offset,
            parent: self.parent,
            q,
            root_id: self.root_id,
        })
    }
}

pub(crate) async fn load_storage_page(
    pool: &SqlitePool,
    query: StorageQuery,
) -> Result<StoragePage, LibraryError> {
    let query = query.normalize()?;
    let mut transaction = pool.begin().await.map_err(|_| LibraryError::database())?;
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM catalog_meta WHERE id = 1")
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| LibraryError::database())?;

    let (items, total) = match query.root_id {
        None => load_roots(&mut transaction, &query).await?,
        Some(IMPORTED_ROOT_ID) => load_imported_tracks(&mut transaction, &query).await?,
        Some(root_id) => load_children(&mut transaction, root_id, &query).await?,
    };
    transaction
        .commit()
        .await
        .map_err(|_| LibraryError::database())?;
    Ok(StoragePage {
        items,
        revision,
        total,
    })
}

pub(crate) async fn rebuild_storage_index(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    root_id: i64,
) -> Result<(), LibraryError> {
    sqlx::query("DELETE FROM library_storage_nodes WHERE root_id = ?")
        .bind(root_id)
        .execute(&mut **transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    sqlx::query(REBUILD_STORAGE_INDEX_SQL)
        .bind(root_id)
        .execute(&mut **transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    Ok(())
}

async fn load_roots(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    query: &NormalizedStorageQuery,
) -> Result<(Vec<StorageNode>, i64), LibraryError> {
    let search = fts_expression(&query.q);
    let mut page = QueryBuilder::<Sqlite>::new("WITH root_nodes AS (");
    push_root_nodes(&mut page, search.as_deref());
    page.push(") SELECT root_id, display_path, track_count, COUNT(*) OVER() AS total FROM root_nodes ORDER BY display_path COLLATE NOCASE");
    push_direction(&mut page, query.direction);
    page.push(", display_path COLLATE BINARY");
    push_direction(&mut page, query.direction);
    page.push(" LIMIT ").push_bind(i64::from(query.limit));
    page.push(" OFFSET ").push_bind(i64::from(query.offset));
    let rows = page
        .build()
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    let total = rows
        .first()
        .map(|row| row.try_get("total").map_err(|_| LibraryError::database()))
        .transpose()?
        .unwrap_or(0);
    let items = rows
        .iter()
        .map(|row| {
            let root_id = row
                .try_get::<i64, _>("root_id")
                .map_err(|_| LibraryError::database())?;
            let display_path = row
                .try_get::<String, _>("display_path")
                .map_err(|_| LibraryError::database())?;
            let name = if root_id == IMPORTED_ROOT_ID {
                display_path.clone()
            } else {
                Path::new(&display_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .filter(|name| !name.is_empty())
                    .unwrap_or(&display_path)
                    .to_owned()
            };
            Ok(StorageNode {
                display_path,
                kind: StorageNodeKind::Root,
                name,
                relative_path: String::new(),
                root_id,
                song_id: None,
                track_count: row
                    .try_get("track_count")
                    .map_err(|_| LibraryError::database())?,
            })
        })
        .collect::<Result<Vec<_>, LibraryError>>()?;
    Ok((items, total))
}

fn push_root_nodes(builder: &mut QueryBuilder<'_, Sqlite>, search: Option<&str>) {
    builder.push(
        "SELECT roots.id AS root_id, roots.path AS display_path, COUNT(songs.id) AS track_count
         FROM library_roots AS roots
         JOIN songs ON songs.root_id = roots.id AND songs.availability = 'available'
         WHERE roots.enabled = 1",
    );
    push_search_condition(builder, search);
    builder.push(" GROUP BY roots.id, roots.path UNION ALL SELECT 0, 'Imported files', COUNT(*) FROM songs WHERE root_id IS NULL AND availability = 'available'");
    push_search_condition(builder, search);
    builder.push(" HAVING COUNT(*) > 0");
}

async fn load_imported_tracks(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    query: &NormalizedStorageQuery,
) -> Result<(Vec<StorageNode>, i64), LibraryError> {
    let search = fts_expression(&query.q);
    let mut page = QueryBuilder::<Sqlite>::new(
        "SELECT id, file, COUNT(*) OVER() AS total FROM songs WHERE root_id IS NULL AND availability = 'available'",
    );
    push_search_condition(&mut page, search.as_deref());
    page.push(" ORDER BY file COLLATE NOCASE");
    push_direction(&mut page, query.direction);
    page.push(", id COLLATE BINARY");
    push_direction(&mut page, query.direction);
    page.push(" LIMIT ").push_bind(i64::from(query.limit));
    page.push(" OFFSET ").push_bind(i64::from(query.offset));
    let rows = page
        .build()
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    let total = rows
        .first()
        .map(|row| row.try_get("total").map_err(|_| LibraryError::database()))
        .transpose()?
        .unwrap_or(0);
    let items = rows
        .iter()
        .map(|row| {
            let id = row
                .try_get::<String, _>("id")
                .map_err(|_| LibraryError::database())?;
            Ok(StorageNode {
                display_path: String::new(),
                kind: StorageNodeKind::Track,
                name: row.try_get("file").map_err(|_| LibraryError::database())?,
                relative_path: id.clone(),
                root_id: IMPORTED_ROOT_ID,
                song_id: Some(id),
                track_count: 1,
            })
        })
        .collect::<Result<Vec<_>, LibraryError>>()?;
    Ok((items, total))
}

async fn load_children(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    root_id: i64,
    query: &NormalizedStorageQuery,
) -> Result<(Vec<StorageNode>, i64), LibraryError> {
    let search = fts_expression(&query.q);
    if search.is_none() {
        return load_indexed_children(transaction, root_id, query).await;
    }
    let mut page = QueryBuilder::<Sqlite>::new("");
    push_child_ctes(&mut page, root_id, &query.parent, search.as_deref());
    page.push(" SELECT name, kind, track_count, song_id, COUNT(*) OVER() AS total FROM nodes ORDER BY CASE kind WHEN 'directory' THEN 0 ELSE 1 END, name COLLATE NOCASE");
    push_direction(&mut page, query.direction);
    page.push(", name COLLATE BINARY");
    push_direction(&mut page, query.direction);
    page.push(" LIMIT ").push_bind(i64::from(query.limit));
    page.push(" OFFSET ").push_bind(i64::from(query.offset));
    let rows = page
        .build()
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    let total = rows
        .first()
        .map(|row| row.try_get("total").map_err(|_| LibraryError::database()))
        .transpose()?
        .unwrap_or(0);
    let items = rows
        .iter()
        .map(|row| {
            let name = row
                .try_get::<String, _>("name")
                .map_err(|_| LibraryError::database())?;
            let kind = match row
                .try_get::<String, _>("kind")
                .map_err(|_| LibraryError::database())?
                .as_str()
            {
                "directory" => StorageNodeKind::Directory,
                "track" => StorageNodeKind::Track,
                _ => return Err(LibraryError::database()),
            };
            let relative_path = if query.parent.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", query.parent, name)
            };
            Ok(StorageNode {
                display_path: String::new(),
                kind,
                name,
                relative_path,
                root_id,
                song_id: row
                    .try_get("song_id")
                    .map_err(|_| LibraryError::database())?,
                track_count: row
                    .try_get("track_count")
                    .map_err(|_| LibraryError::database())?,
            })
        })
        .collect::<Result<Vec<_>, LibraryError>>()?;
    Ok((items, total))
}

async fn load_indexed_children(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    root_id: i64,
    query: &NormalizedStorageQuery,
) -> Result<(Vec<StorageNode>, i64), LibraryError> {
    let mut page = QueryBuilder::<Sqlite>::new(
        "SELECT relative_path, name, kind, song_id, track_count, COUNT(*) OVER() AS total
         FROM library_storage_nodes WHERE root_id = ",
    );
    page.push_bind(root_id)
        .push(" AND parent_path = ")
        .push_bind(query.parent.clone())
        .push(" ORDER BY CASE kind WHEN 'directory' THEN 0 ELSE 1 END, name COLLATE NOCASE");
    push_direction(&mut page, query.direction);
    page.push(", name COLLATE BINARY");
    push_direction(&mut page, query.direction);
    page.push(" LIMIT ").push_bind(i64::from(query.limit));
    page.push(" OFFSET ").push_bind(i64::from(query.offset));
    let rows = page
        .build()
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| LibraryError::database())?;
    let total = rows
        .first()
        .map(|row| row.try_get("total").map_err(|_| LibraryError::database()))
        .transpose()?
        .unwrap_or(0);
    let items = rows
        .iter()
        .map(|row| {
            let kind = match row
                .try_get::<String, _>("kind")
                .map_err(|_| LibraryError::database())?
                .as_str()
            {
                "directory" => StorageNodeKind::Directory,
                "track" => StorageNodeKind::Track,
                _ => return Err(LibraryError::database()),
            };
            Ok(StorageNode {
                display_path: String::new(),
                kind,
                name: row.try_get("name").map_err(|_| LibraryError::database())?,
                relative_path: row
                    .try_get("relative_path")
                    .map_err(|_| LibraryError::database())?,
                root_id,
                song_id: row
                    .try_get("song_id")
                    .map_err(|_| LibraryError::database())?,
                track_count: row
                    .try_get("track_count")
                    .map_err(|_| LibraryError::database())?,
            })
        })
        .collect::<Result<Vec<_>, LibraryError>>()?;
    Ok((items, total))
}

fn push_child_ctes(
    builder: &mut QueryBuilder<'_, Sqlite>,
    root_id: i64,
    parent: &str,
    search: Option<&str>,
) {
    builder.push("WITH candidates AS (SELECT id, normalized_path, substr(normalized_path, ");
    if parent.is_empty() {
        builder.push("1");
    } else {
        builder
            .push("length(")
            .push_bind(parent.to_owned())
            .push(") + 2");
    }
    builder
        .push(") AS remainder FROM songs WHERE root_id = ")
        .push_bind(root_id)
        .push(" AND availability = 'available' AND normalized_path IS NOT NULL");
    if !parent.is_empty() {
        builder
            .push(" AND normalized_path >= ")
            .push_bind(format!("{parent}/"))
            .push(" AND normalized_path < ")
            .push_bind(format!("{parent}0"));
    }
    push_search_condition(builder, search);
    builder.push(
        "), parts AS (
           SELECT id, remainder, instr(remainder, '/') AS separator_index FROM candidates
         ), nodes AS (
           SELECT CASE WHEN separator_index > 0 THEN substr(remainder, 1, separator_index - 1)
                       ELSE remainder END AS name,
                  CASE WHEN separator_index > 0 THEN 'directory' ELSE 'track' END AS kind,
                  COUNT(*) AS track_count,
                  MAX(CASE WHEN separator_index = 0 THEN id END) AS song_id
           FROM parts GROUP BY name, kind
         )",
    );
}

fn push_search_condition(builder: &mut QueryBuilder<'_, Sqlite>, search: Option<&str>) {
    if let Some(search) = search {
        builder
            .push(" AND songs.id IN (SELECT song_id FROM songs_fts WHERE songs_fts MATCH ")
            .push_bind(search.to_owned())
            .push(")");
    }
}

fn push_direction(builder: &mut QueryBuilder<'_, Sqlite>, direction: SortDirection) {
    builder.push(match direction {
        SortDirection::Asc => " ASC",
        SortDirection::Desc => " DESC",
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{LibraryRepository, TrackQuery};
    use sqlx::sqlite::SqlitePoolOptions;

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    async fn fixture() -> (SqlitePool, i64, i64) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open storage fixture");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate storage fixture");
        let first_root: i64 = sqlx::query_scalar(
            "INSERT INTO library_roots (path, canonical_path) VALUES ('/library-one', '/library-one') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .expect("insert first root");
        let second_root: i64 = sqlx::query_scalar(
            "INSERT INTO library_roots (path, canonical_path) VALUES ('/library-two', '/library-two') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .expect("insert second root");

        for (id, root_id, normalized_path) in [
            ("rock-a", Some(first_root), Some("Rock/Album/song-a.flac")),
            ("rock-b", Some(first_root), Some("Rock/Album/song-b.flac")),
            ("single", Some(first_root), Some("Rock/single.flac")),
            ("jazz", Some(first_root), Some("Jazz/song.flac")),
            ("top", Some(first_root), Some("top.flac")),
            ("classical", Some(second_root), Some("Classical/song.flac")),
            ("imported", None, None),
        ] {
            insert_song(&pool, id, root_id, normalized_path).await;
        }
        let mut transaction = pool.begin().await.expect("begin storage index build");
        rebuild_storage_index(&mut transaction, first_root)
            .await
            .expect("build first storage index");
        rebuild_storage_index(&mut transaction, second_root)
            .await
            .expect("build second storage index");
        transaction.commit().await.expect("commit storage indexes");
        (pool, first_root, second_root)
    }

    async fn insert_song(
        pool: &SqlitePool,
        id: &str,
        root_id: Option<i64>,
        normalized_path: Option<&str>,
    ) {
        let file = normalized_path
            .and_then(|path| path.rsplit('/').next())
            .unwrap_or("imported.flac");
        sqlx::query(
            "INSERT INTO songs (
               id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
               trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
               favorRating, dateAdded, visualsPath, root_id, normalized_path
             ) VALUES (?, ?, ?, ?, '', '', '', 0, 0, '', '', 0, 0, 'flac', '', '44100', 0, 0, 0, '', '', ?, ?)",
        )
        .bind(id)
        .bind(format!("/fixture/{file}"))
        .bind(file)
        .bind(id)
        .bind(root_id)
        .bind(normalized_path)
        .execute(pool)
        .await
        .expect("insert storage song");
    }

    #[test]
    fn root_and_child_pages_are_grouped_bounded_and_revision_aware() {
        run_async(async {
            let (pool, first_root, _) = fixture().await;
            let roots = load_storage_page(
                &pool,
                StorageQuery {
                    limit: 1_000,
                    ..StorageQuery::default()
                },
            )
            .await
            .expect("load roots");
            assert_eq!(roots.total, 3);
            assert_eq!(roots.items.len(), 3);
            assert_eq!(roots.revision, 7);
            assert!(roots
                .items
                .iter()
                .all(|node| node.kind == StorageNodeKind::Root));

            let top = load_storage_page(
                &pool,
                StorageQuery {
                    root_id: Some(first_root),
                    ..StorageQuery::default()
                },
            )
            .await
            .expect("load top-level children");
            assert_eq!(top.total, 3);
            assert_eq!(
                top.items
                    .iter()
                    .map(|node| (node.name.as_str(), &node.kind, node.track_count))
                    .collect::<Vec<_>>(),
                vec![
                    ("Jazz", &StorageNodeKind::Directory, 1),
                    ("Rock", &StorageNodeKind::Directory, 3),
                    ("top.flac", &StorageNodeKind::Track, 1),
                ]
            );
            assert_eq!(top.items[2].song_id.as_deref(), Some("top"));

            let rock = load_storage_page(
                &pool,
                StorageQuery {
                    parent: "Rock".to_owned(),
                    root_id: Some(first_root),
                    ..StorageQuery::default()
                },
            )
            .await
            .expect("load nested children");
            assert_eq!(rock.total, 2);
            assert_eq!(rock.items[0].relative_path, "Rock/Album");
            assert_eq!(rock.items[0].track_count, 2);
            assert_eq!(rock.items[1].song_id.as_deref(), Some("single"));
        });
    }

    #[test]
    fn search_paging_direction_and_imported_tracks_preserve_the_contract() {
        run_async(async {
            let (pool, first_root, _) = fixture().await;
            let roots = load_storage_page(
                &pool,
                StorageQuery {
                    q: "single".to_owned(),
                    ..StorageQuery::default()
                },
            )
            .await
            .expect("search roots");
            assert_eq!(roots.total, 1);
            assert_eq!(roots.items[0].root_id, first_root);

            let top = load_storage_page(
                &pool,
                StorageQuery {
                    q: "single".to_owned(),
                    root_id: Some(first_root),
                    ..StorageQuery::default()
                },
            )
            .await
            .expect("search child paths");
            assert_eq!(top.items.len(), 1);
            assert_eq!(top.items[0].name, "Rock");

            let paged = load_storage_page(
                &pool,
                StorageQuery {
                    direction: SortDirection::Desc,
                    limit: 1,
                    offset: 1,
                    root_id: Some(first_root),
                    ..StorageQuery::default()
                },
            )
            .await
            .expect("page children");
            assert_eq!(paged.total, 3);
            assert_eq!(paged.items.len(), 1);
            assert_eq!(paged.items[0].name, "Jazz");

            for index in 0..105 {
                insert_song(&pool, &format!("imported-{index:03}"), None, None).await;
            }
            let imported = load_storage_page(
                &pool,
                StorageQuery {
                    limit: 1_000,
                    root_id: Some(IMPORTED_ROOT_ID),
                    ..StorageQuery::default()
                },
            )
            .await
            .expect("load imported files");
            assert_eq!(imported.total, 106);
            assert_eq!(imported.items.len(), MAX_PAGE_SIZE as usize);
            assert!(imported
                .items
                .iter()
                .all(|node| node.kind == StorageNodeKind::Track));
        });
    }

    #[test]
    fn storage_selection_filters_native_subtrees_and_imported_ids() {
        run_async(async {
            let (pool, first_root, _) = fixture().await;
            let repository = LibraryRepository::new(pool);
            let album = repository
                .query_tracks(TrackQuery {
                    path_prefix: Some("Rock/Album".to_owned()),
                    root_id: Some(first_root),
                    ..TrackQuery::default()
                })
                .await
                .expect("load native subtree");
            assert_eq!(album.total, 2);
            assert!(album
                .items
                .iter()
                .all(|track| track.id.starts_with("rock-")));

            let imported = repository
                .query_tracks(TrackQuery {
                    path_prefix: Some("imported".to_owned()),
                    root_id: Some(IMPORTED_ROOT_ID),
                    ..TrackQuery::default()
                })
                .await
                .expect("load imported track");
            assert_eq!(imported.total, 1);
            assert_eq!(imported.items[0].id, "imported");
        });
    }

    #[test]
    fn invalid_storage_queries_fail_before_database_work() {
        run_async(async {
            let (pool, _, _) = fixture().await;
            for query in [
                StorageQuery {
                    limit: 0,
                    ..StorageQuery::default()
                },
                StorageQuery {
                    parent: "folder".to_owned(),
                    ..StorageQuery::default()
                },
                StorageQuery {
                    parent: "../escape".to_owned(),
                    root_id: Some(1),
                    ..StorageQuery::default()
                },
                StorageQuery {
                    parent: "nested".to_owned(),
                    root_id: Some(IMPORTED_ROOT_ID),
                    ..StorageQuery::default()
                },
            ] {
                assert_eq!(
                    load_storage_page(&pool, query)
                        .await
                        .expect_err("reject invalid storage query")
                        .code,
                    "invalid_query"
                );
            }
        });
    }

    #[test]
    fn storage_schema_backfills_existing_native_paths_and_parent_queries_use_the_index() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open pre-storage fixture");
            for schema in [
                crate::database::INITIAL_SCHEMA,
                crate::database::CATALOG_QUERY_SCHEMA,
                crate::database::LIBRARY_SCAN_SCHEMA,
                crate::database::LIBRARY_DISCOVERY_SCHEMA,
                crate::database::LIBRARY_METADATA_SCHEMA,
                crate::database::LIBRARY_RECONCILIATION_SCHEMA,
                crate::database::LIBRARY_REFRESH_SCHEMA,
            ] {
                sqlx::raw_sql(schema)
                    .execute(&pool)
                    .await
                    .expect("apply pre-storage schema");
            }
            let root_id: i64 = sqlx::query_scalar(
                "INSERT INTO library_roots (path, canonical_path) VALUES ('/existing', '/existing') RETURNING id",
            )
            .fetch_one(&pool)
            .await
            .expect("insert existing root");
            insert_song(
                &pool,
                "existing-track",
                Some(root_id),
                Some("Artist/Album/track.flac"),
            )
            .await;

            sqlx::raw_sql(crate::database::LIBRARY_STORAGE_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply storage schema");
            let nodes: Vec<(String, String, i64)> = sqlx::query_as(
                "SELECT relative_path, kind, track_count FROM library_storage_nodes ORDER BY relative_path",
            )
            .fetch_all(&pool)
            .await
            .expect("read backfilled nodes");
            assert_eq!(
                nodes,
                vec![
                    ("Artist".to_owned(), "directory".to_owned(), 1),
                    ("Artist/Album".to_owned(), "directory".to_owned(), 1),
                    ("Artist/Album/track.flac".to_owned(), "track".to_owned(), 1),
                ]
            );

            let plan = sqlx::query(
                "EXPLAIN QUERY PLAN SELECT relative_path FROM library_storage_nodes
                 WHERE root_id = ? AND parent_path = ? ORDER BY kind, name COLLATE NOCASE",
            )
            .bind(root_id)
            .bind("Artist")
            .fetch_all(&pool)
            .await
            .expect("inspect storage query plan");
            assert!(plan
                .iter()
                .filter_map(|row| row.try_get::<String, _>("detail").ok())
                .any(|detail| detail.contains("idx_library_storage_nodes_parent")));
        });
    }

    #[test]
    fn storage_query_serializes_with_stable_camel_case_fields() {
        let value = serde_json::to_value(StorageQuery {
            direction: SortDirection::Desc,
            limit: 25,
            offset: 50,
            parent: "Artist/Album".to_owned(),
            q: "needle".to_owned(),
            root_id: Some(7),
        })
        .expect("serialize storage query");
        assert_eq!(value["rootId"], 7);
        assert_eq!(value["parent"], "Artist/Album");
        assert_eq!(value["direction"], "desc");
        assert!(value.get("root_id").is_none());
    }
}

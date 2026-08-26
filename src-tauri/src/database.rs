use tauri_plugin_sql::{Migration, MigrationKind};

pub const LIBRARY_DB_URL: &str = "sqlite:library.db";

pub(crate) const INITIAL_SCHEMA: &str = include_str!("../migrations/0001_initial.sql");
pub(crate) const CATALOG_QUERY_SCHEMA: &str = include_str!("../migrations/0002_catalog_query.sql");

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create initial songs table",
            sql: INITIAL_SCHEMA,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add indexed catalog queries",
            sql: CATALOG_QUERY_SCHEMA,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    const PRE_0002_FIXTURE: &str = r#"
        INSERT INTO songs VALUES
          ('01', '/Music/Björk/Jóga.flac', 'Jóga.flac', 'Jóga', 'Homogenic', 'Björk', 'Electronic', 90, 0, '1997', 'encoder', 10, 2, 'flac', '0:05:05.000', '44100', 1, 0, 0, '2025-01-01', ''),
          ('02', '/Music/Björk/All Is Full of Love.flac', 'All Is Full of Love.flac', 'All Is Full of Love', 'Homogenic', 'Björk', 'Electronic', 72, 0, '1997', 'encoder', 10, 10, 'flac', '0:04:32.000', '48000', 1, 0, 1, '2025-01-02', ''),
          ('03', '/Music/Various/Intro A.flac', 'Intro A.flac', 'Intro', 'Duplicate Album', 'Álvaro', '', 0, 1, '2020', 'encoder', 4, 1, 'flac', '0:01:00.000', '44100', 1, 0, 2, '2025-02-01', ''),
          ('04', '/Music/Various/Intro B.flac', 'Intro B.flac', 'Intro', 'Duplicate Album', 'Álvaro', '', 0, 1, '2020', 'encoder', 4, 1, 'flac', '0:01:01.000', '44100', 2, 0, 1, '2025-02-02', ''),
          ('05', '/Music/Percent/100_percent.flac', '100_percent.flac', '100% Real', 'Symbols_%', 'Test Artist', '', 0, 0, '2026', 'encoder', 1, 1, 'flac', '0:02:00.000', '96000', 1, 0, 0, '2025-03-01', '');
    "#;

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn initial_schema_creates_the_expected_table() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");

            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");

            let columns: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pragma_table_info('songs') WHERE name IN ('id', 'path', 'title', 'favorRating', 'visualsPath')",
            )
            .fetch_one(&pool)
            .await
            .expect("inspect songs schema");

            assert_eq!(columns, 5);
        });
    }

    #[test]
    fn initial_schema_is_safe_for_existing_databases() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");

            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("reapply initial schema");

            let tables: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'songs'",
            )
            .fetch_one(&pool)
            .await
            .expect("count songs tables");

            assert_eq!(tables, 1);
        });
    }

    #[test]
    fn favorite_rating_constraint_rejects_invalid_values() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");

            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");

            let result = sqlx::query(
                "INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind("id")
            .bind("/music")
            .bind("track.flac")
            .bind("Track")
            .bind("Album")
            .bind("Artist")
            .bind("")
            .bind(0_i64)
            .bind(0_i64)
            .bind("")
            .bind("")
            .bind(1_i64)
            .bind(1_i64)
            .bind("FLAC")
            .bind("0")
            .bind("44100")
            .bind(0_i64)
            .bind(0_i64)
            .bind(3_i64)
            .bind("2026-01-01")
            .bind("")
            .execute(&pool)
            .await;

            assert!(result.is_err());
        });
    }

    #[test]
    fn catalog_query_schema_upgrades_existing_rows_without_loss_and_supports_fts5() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");
            sqlx::raw_sql(PRE_0002_FIXTURE)
                .execute(&pool)
                .await
                .expect("load pre-0002 fixture");

            sqlx::raw_sql(CATALOG_QUERY_SCHEMA)
                .execute(&pool)
                .await
                .expect("upgrade fixture with bundled FTS5");

            let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM songs")
                .fetch_one(&pool)
                .await
                .expect("count preserved rows");
            let rating_sum: i64 = sqlx::query_scalar("SELECT SUM(favorRating) FROM songs")
                .fetch_one(&pool)
                .await
                .expect("sum preserved ratings");
            let unicode_match: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH ?")
                    .bind(r#""Björk""#)
                    .fetch_one(&pool)
                    .await
                    .expect("search Unicode metadata");
            let wildcard_like_match: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH ?")
                    .bind(r#""100""#)
                    .fetch_one(&pool)
                    .await
                    .expect("search wildcard-like metadata");

            assert_eq!(row_count, 5);
            assert_eq!(rating_sum, 4);
            assert_eq!(unicode_match, 2);
            assert_eq!(wildcard_like_match, 1);
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read initial revision"),
                0
            );

            sqlx::raw_sql(CATALOG_QUERY_SCHEMA)
                .execute(&pool)
                .await
                .expect("reapply catalog schema");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs_fts")
                    .fetch_one(&pool)
                    .await
                    .expect("count fts rows"),
                5
            );
        });
    }

    #[test]
    fn catalog_triggers_advance_revision_and_keep_search_in_sync() {
        run_async(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open in-memory database");
            sqlx::raw_sql(INITIAL_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply initial schema");
            sqlx::raw_sql(CATALOG_QUERY_SCHEMA)
                .execute(&pool)
                .await
                .expect("apply catalog schema");

            sqlx::raw_sql(PRE_0002_FIXTURE)
                .execute(&pool)
                .await
                .expect("insert fixture through triggers");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read insert revision"),
                5
            );

            sqlx::query("UPDATE songs SET title = ? WHERE id = ?")
                .bind("Changed Title")
                .bind("01")
                .execute(&pool)
                .await
                .expect("update song");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read update revision"),
                6
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH 'changed'"
                )
                .fetch_one(&pool)
                .await
                .expect("find updated title"),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM songs_fts WHERE songs_fts MATCH 'title:jóga'"
                )
                .fetch_one(&pool)
                .await
                .expect("confirm old title removed"),
                0
            );

            sqlx::query("DELETE FROM songs WHERE id = ?")
                .bind("01")
                .execute(&pool)
                .await
                .expect("delete song");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT revision FROM catalog_meta WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .expect("read delete revision"),
                7
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs_fts WHERE song_id = '01'")
                    .fetch_one(&pool)
                    .await
                    .expect("confirm deleted fts row"),
                0
            );
        });
    }
}

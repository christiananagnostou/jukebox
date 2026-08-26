use tauri_plugin_sql::{Migration, MigrationKind};

pub const LIBRARY_DB_URL: &str = "sqlite:library.db";

pub(crate) const INITIAL_SCHEMA: &str = include_str!("../migrations/0001_initial.sql");

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create initial songs table",
        sql: INITIAL_SCHEMA,
        kind: MigrationKind::Up,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

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
}

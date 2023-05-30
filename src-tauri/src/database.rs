use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::Row;

#[derive(Debug, Clone)]
pub struct Database {
    pub connection: SqlitePool,
}

impl Database {
    pub fn new(db_url: &str) -> Self {
        let db_pool = match SqlitePoolOptions::new()
            .max_connections(5)
            .connect(db_url).await {
                Ok(pool) => pool,
                Err(e) => panic!("Couldn't establish DB connection: {}", e),
            };

        Database {
            connection: db_pool,
        }
    }
}

use super::facets::{FacetQuery, TrackFacet};
use super::query::TrackAvailability;
use super::{AggregateQuery, LibraryState, StorageQuery, TrackQuery};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use std::hint::black_box;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

const REFERENCE_TRACKS: i64 = 100_000;
const INSERT_BATCH_SIZE: i64 = 200;
const QUERY_SAMPLES: usize = 20;
const QUERY_P95_BUDGET: Duration = Duration::from_millis(100);
const PREPARATION_BUDGET: Duration = Duration::from_secs(5);
const PUBLISH_BUDGET: Duration = Duration::from_secs(5);

#[derive(Debug)]
struct QueryBudget {
    name: &'static str,
    p95: Duration,
}

#[test]
#[ignore = "opt-in 100k-track release benchmark; run with --release --ignored --nocapture"]
fn reference_100k_library_performance() {
    tauri::async_runtime::block_on(async {
        let (_directory, pool, scan_id) = reference_fixture().await;
        let library = LibraryState::from_pool(pool);
        let browse = TrackQuery {
            limit: 100,
            ..TrackQuery::default()
        };
        let search = TrackQuery {
            limit: 100,
            q: "Needle".to_owned(),
            ..TrackQuery::default()
        };
        let first = library
            .repository
            .query_tracks(browse.clone())
            .await
            .expect("load reference first page");
        let continuation = TrackQuery {
            cursor: first.next_cursor,
            limit: 100,
            ..TrackQuery::default()
        };
        let filtered = TrackQuery {
            availability: TrackAvailability::Available,
            genre: Some("Genre 07".to_owned()),
            min_favorite_rating: Some(1),
            year: Some(2007),
            ..TrackQuery::default()
        };

        let query_budgets = [
            measure_query(&library, "browse_first_page", browse).await,
            measure_query(&library, "fts_search", search).await,
            measure_query(&library, "browse_continuation", continuation).await,
            measure_query(&library, "indexed_filters", filtered).await,
            measure_facet_query(&library).await,
            measure_artist_query(&library).await,
            measure_album_query(&library).await,
            measure_storage_query(&library, "storage_roots", StorageQuery::default()).await,
            measure_storage_query(
                &library,
                "storage_root_children",
                StorageQuery {
                    root_id: Some(1),
                    ..StorageQuery::default()
                },
            )
            .await,
        ];
        for budget in &query_budgets {
            assert!(
                budget.p95 <= QUERY_P95_BUDGET,
                "{} p95 {:?} exceeded {:?}",
                budget.name,
                budget.p95,
                QUERY_P95_BUDGET
            );
        }

        let scan_files: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM library_scan_files WHERE scan_id = ?")
                .bind(scan_id)
                .fetch_one(&library.repository.pool())
                .await
                .expect("count reference scan files");
        let unchanged_candidates: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM library_scan_files AS files
             JOIN library_scans AS scans ON scans.id = files.scan_id
             JOIN songs
               ON songs.root_id = scans.root_id
              AND songs.normalized_path = files.normalized_path
              AND songs.file_size = files.file_size
              AND songs.modified_at_ns = files.modified_at_ns
              AND songs.metadata_version = ?
             WHERE files.scan_id = ?",
        )
        .bind(super::reconciliation::METADATA_VERSION)
        .bind(scan_id)
        .fetch_one(&library.repository.pool())
        .await
        .expect("count unchanged reference candidates");
        assert_eq!(scan_files, REFERENCE_TRACKS);
        assert_eq!(unchanged_candidates, REFERENCE_TRACKS);

        let preparation_started = Instant::now();
        let task = library
            .reconciliation
            .begin(scan_id, Arc::new(AtomicBool::new(false)))
            .await
            .expect("begin no-change preparation");
        let prepared = library
            .reconciliation
            .complete(task, None)
            .await
            .expect("complete no-change preparation");
        let preparation = preparation_started.elapsed();
        assert_eq!(prepared.changed, 0);
        assert_eq!(prepared.unchanged, REFERENCE_TRACKS);
        assert_eq!(prepared.status, "ready");
        assert!(
            preparation <= PREPARATION_BUDGET,
            "no-change preparation {:?} exceeded {:?}",
            preparation,
            PREPARATION_BUDGET
        );

        let publish_started = Instant::now();
        let published = library
            .reconciliation
            .apply(scan_id)
            .await
            .expect("publish no-change snapshot");
        let publish = publish_started.elapsed();
        assert_eq!(published.status, "completed");
        assert_eq!(published.unavailable, 0);
        assert!(
            publish <= PUBLISH_BUDGET,
            "no-change publish {:?} exceeded {:?}",
            publish,
            PUBLISH_BUDGET
        );

        let query_report = query_budgets
            .iter()
            .map(|budget| format!("{}={:?}", budget.name, budget.p95))
            .collect::<Vec<_>>()
            .join(" ");
        eprintln!(
            "reference_tracks={REFERENCE_TRACKS} {query_report} preparation={preparation:?} publish={publish:?}"
        );
    });
}

async fn measure_facet_query(library: &LibraryState) -> QueryBudget {
    let query = FacetQuery {
        kind: TrackFacet::Genre,
        limit: 100,
        ..FacetQuery::default()
    };
    library
        .query_facets(query.clone())
        .await
        .expect("warm reference facet query");
    let mut samples = Vec::with_capacity(QUERY_SAMPLES);
    for _ in 0..QUERY_SAMPLES {
        let started = Instant::now();
        let page = library
            .query_facets(query.clone())
            .await
            .expect("run reference facet query");
        samples.push(started.elapsed());
        black_box(page.items.len());
    }
    samples.sort_unstable();
    QueryBudget {
        name: "genre_facets",
        p95: samples[(QUERY_SAMPLES * 95).div_ceil(100) - 1],
    }
}

async fn measure_artist_query(library: &LibraryState) -> QueryBudget {
    let query = AggregateQuery::default();
    library
        .query_artists(query.clone())
        .await
        .expect("warm reference artist query");
    let mut samples = Vec::with_capacity(QUERY_SAMPLES);
    for _ in 0..QUERY_SAMPLES {
        let started = Instant::now();
        let page = library
            .query_artists(query.clone())
            .await
            .expect("run reference artist query");
        samples.push(started.elapsed());
        black_box(page.items.len());
    }
    samples.sort_unstable();
    QueryBudget {
        name: "artist_first_page",
        p95: samples[(QUERY_SAMPLES * 95).div_ceil(100) - 1],
    }
}

async fn measure_album_query(library: &LibraryState) -> QueryBudget {
    let query = AggregateQuery::default();
    library
        .query_albums(query.clone())
        .await
        .expect("warm reference album query");
    let mut samples = Vec::with_capacity(QUERY_SAMPLES);
    for _ in 0..QUERY_SAMPLES {
        let started = Instant::now();
        let page = library
            .query_albums(query.clone())
            .await
            .expect("run reference album query");
        samples.push(started.elapsed());
        black_box(page.items.len());
    }
    samples.sort_unstable();
    QueryBudget {
        name: "album_first_page",
        p95: samples[(QUERY_SAMPLES * 95).div_ceil(100) - 1],
    }
}

async fn measure_storage_query(
    library: &LibraryState,
    name: &'static str,
    query: StorageQuery,
) -> QueryBudget {
    library
        .query_storage(query.clone())
        .await
        .expect("warm reference storage query");
    let mut samples = Vec::with_capacity(QUERY_SAMPLES);
    for _ in 0..QUERY_SAMPLES {
        let started = Instant::now();
        let page = library
            .query_storage(query.clone())
            .await
            .expect("run reference storage query");
        samples.push(started.elapsed());
        black_box(page.items.len());
    }
    samples.sort_unstable();
    QueryBudget {
        name,
        p95: samples[(QUERY_SAMPLES * 95).div_ceil(100) - 1],
    }
}

async fn measure_query(
    library: &LibraryState,
    name: &'static str,
    query: TrackQuery,
) -> QueryBudget {
    library
        .repository
        .query_tracks(query.clone())
        .await
        .expect("warm reference query");
    let mut samples = Vec::with_capacity(QUERY_SAMPLES);
    for _ in 0..QUERY_SAMPLES {
        let started = Instant::now();
        let page = library
            .repository
            .query_tracks(query.clone())
            .await
            .expect("run reference query");
        samples.push(started.elapsed());
        black_box(page.items.len());
    }
    samples.sort_unstable();
    QueryBudget {
        name,
        p95: samples[(QUERY_SAMPLES * 95).div_ceil(100) - 1],
    }
}

async fn reference_fixture() -> (tempfile::TempDir, SqlitePool, i64) {
    let directory = tempfile::tempdir().expect("create reference fixture directory");
    let root_path = directory.path().join("music");
    std::fs::create_dir(&root_path).expect("create reference music directory");
    let root_path = root_path
        .canonicalize()
        .expect("canonicalize reference music directory");
    let root_path_text = root_path.to_string_lossy().into_owned();
    let options = SqliteConnectOptions::new()
        .filename(directory.path().join("library.db"))
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("open reference fixture database");
    crate::database::NATIVE_MIGRATOR
        .run(&pool)
        .await
        .expect("migrate reference fixture database");
    let root_id: i64 = sqlx::query_scalar(
        "INSERT INTO library_roots (path, canonical_path) VALUES (?, ?) RETURNING id",
    )
    .bind(&root_path_text)
    .bind(&root_path_text)
    .fetch_one(&pool)
    .await
    .expect("insert reference root");
    let scan_id: i64 = sqlx::query_scalar(
        "INSERT INTO library_scans (root_id, status, completed_at, discovered)
         VALUES (?, 'completed', CURRENT_TIMESTAMP, ?) RETURNING id",
    )
    .bind(root_id)
    .bind(REFERENCE_TRACKS)
    .fetch_one(&pool)
    .await
    .expect("insert reference scan");

    let mut transaction = pool.begin().await.expect("begin reference fixture");
    for start in (0..REFERENCE_TRACKS).step_by(INSERT_BATCH_SIZE as usize) {
        let end = (start + INSERT_BATCH_SIZE).min(REFERENCE_TRACKS);
        let mut songs = QueryBuilder::<Sqlite>::new(
            "INSERT INTO songs (
               id, path, file, title, album, artist, genre, bpm, compilation, date, encoder,
               trackTotal, trackNumber, codec, duration, sampleRate, side, startTime,
               favorRating, dateAdded, visualsPath, root_id, normalized_path, file_size,
               modified_at_ns, quick_fingerprint, availability, last_seen_scan_id,
               metadata_version
             ) ",
        );
        songs.push_values(start..end, |mut row, index| {
            let normalized_path = reference_relative_path(index);
            row.push_bind(format!("song-{index:06}"))
                .push_bind(
                    root_path
                        .join(&normalized_path)
                        .to_string_lossy()
                        .into_owned(),
                )
                .push_bind(format!("track-{index:06}.flac"))
                .push_bind(if index % 1_000 == 0 {
                    format!("Needle {index:06}")
                } else {
                    format!("Track {index:06}")
                })
                .push_bind(format!("Album {:05}", index % 10_000))
                .push_bind(format!("Artist {:04}", index % 2_000))
                .push_bind(format!("Genre {:02}", index % 20))
                .push_bind(0_i64)
                .push_bind(0_i64)
                .push_bind(format!("{}", 1980 + index % 47))
                .push_bind("")
                .push_bind(10_i64)
                .push_bind(index % 10 + 1)
                .push_bind("flac")
                .push_bind("0:03:00.000")
                .push_bind("44100")
                .push_bind(1_i64)
                .push_bind(0_i64)
                .push_bind(index % 3)
                .push_bind("2026-08-26")
                .push_bind("")
                .push_bind(root_id)
                .push_bind(normalized_path)
                .push_bind(1_048_576_i64 + index)
                .push_bind(1_700_000_000_000_000_000_i64 + index)
                .push_bind(format!("fingerprint-{index:06}"))
                .push_bind("available")
                .push_bind(Option::<i64>::None)
                .push_bind(super::reconciliation::METADATA_VERSION);
        });
        songs
            .build()
            .execute(&mut *transaction)
            .await
            .expect("insert reference songs");

        let mut files = QueryBuilder::<Sqlite>::new(
            "INSERT INTO library_scan_files
             (scan_id, normalized_path, file_size, modified_at_ns) ",
        );
        files.push_values(start..end, |mut row, index| {
            row.push_bind(scan_id)
                .push_bind(reference_relative_path(index))
                .push_bind(1_048_576_i64 + index)
                .push_bind(1_700_000_000_000_000_000_i64 + index);
        });
        files
            .build()
            .execute(&mut *transaction)
            .await
            .expect("insert reference scan files");
    }
    transaction
        .commit()
        .await
        .expect("commit reference fixture");
    let mut transaction = pool.begin().await.expect("begin storage index build");
    super::storage::rebuild_storage_index(&mut transaction, root_id)
        .await
        .expect("build reference storage index");
    transaction
        .commit()
        .await
        .expect("commit reference storage index");
    (directory, pool, scan_id)
}

fn reference_relative_path(index: i64) -> String {
    format!(
        "artist-{:04}/album-{:05}/track-{index:06}.flac",
        index % 2_000,
        index % 10_000
    )
}

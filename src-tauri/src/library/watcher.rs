use super::{LibraryError, LibraryState};
use notify::event::EventKind;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::Instant;

const SIGNAL_CAPACITY: usize = 64;
const DEBOUNCE_DELAY: Duration = Duration::from_millis(750);
const MAX_DEBOUNCE_DELAY: Duration = Duration::from_secs(5);
const SCHEDULER_TICK: Duration = Duration::from_millis(250);
const RETRY_DELAY: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, PartialEq)]
enum SignalReason {
    Changed,
    Recover,
    WatcherError,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct WatchSignal {
    root_id: i64,
    reason: SignalReason,
}

#[derive(Clone, Copy)]
struct PendingRefresh {
    first_seen: Instant,
    due_at: Instant,
    restart_watcher: bool,
}

#[derive(Default)]
struct WatcherRuntime {
    active: HashMap<i64, RecommendedWatcher>,
    sender: Option<mpsc::Sender<WatchSignal>>,
}

#[derive(Clone, Default)]
pub(super) struct WatcherService {
    runtime: Arc<Mutex<WatcherRuntime>>,
    overflowed: Arc<Mutex<HashSet<i64>>>,
}

impl LibraryState {
    pub(crate) async fn recover_library_watchers(
        &self,
        app: tauri::AppHandle,
    ) -> Result<(), LibraryError> {
        self.ensure_initialized().await?;
        let sender = self.ensure_watcher_scheduler(app.clone())?;
        let rows = sqlx::query(
            "SELECT id, canonical_path FROM library_roots WHERE enabled = 1 ORDER BY id",
        )
        .fetch_all(&self.repository.pool())
        .await
        .map_err(|_| LibraryError::database())?;
        let enabled_ids = rows
            .iter()
            .map(|row| row.try_get::<i64, _>("id"))
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|_| LibraryError::database())?;

        sqlx::query("UPDATE library_roots SET watch_status = 'inactive' WHERE enabled = 0")
            .execute(&self.repository.pool())
            .await
            .map_err(|_| LibraryError::database())?;
        self.remove_disabled_watchers(&enabled_ids)?;
        for row in rows {
            let root_id = row
                .try_get::<i64, _>("id")
                .map_err(|_| LibraryError::database())?;
            let path = row
                .try_get::<String, _>("canonical_path")
                .map_err(|_| LibraryError::database())?;
            self.install_watcher(root_id, PathBuf::from(path), sender.clone(), true)
                .await?;
            enqueue_signal(
                &sender,
                &self.watchers.overflowed,
                WatchSignal {
                    root_id,
                    reason: SignalReason::Recover,
                },
            );
        }
        Ok(())
    }

    pub(crate) async fn sync_library_root_watcher(
        &self,
        root_id: i64,
        app: tauri::AppHandle,
        schedule_refresh: bool,
    ) -> Result<(), LibraryError> {
        self.ensure_initialized().await?;
        let sender = self.ensure_watcher_scheduler(app)?;
        let row = sqlx::query("SELECT canonical_path, enabled FROM library_roots WHERE id = ?")
            .bind(root_id)
            .fetch_optional(&self.repository.pool())
            .await
            .map_err(|_| LibraryError::database())?
            .ok_or_else(LibraryError::root_not_found)?;
        let enabled = row
            .try_get::<i64, _>("enabled")
            .map_err(|_| LibraryError::database())?
            != 0;

        if !enabled {
            self.remove_watcher(root_id)?;
            self.set_watch_status(root_id, "inactive").await?;
            return Ok(());
        }

        let path = row
            .try_get::<String, _>("canonical_path")
            .map_err(|_| LibraryError::database())?;
        self.install_watcher(root_id, PathBuf::from(path), sender.clone(), true)
            .await?;
        if schedule_refresh {
            enqueue_signal(
                &sender,
                &self.watchers.overflowed,
                WatchSignal {
                    root_id,
                    reason: SignalReason::Recover,
                },
            );
        }
        Ok(())
    }

    fn ensure_watcher_scheduler(
        &self,
        app: tauri::AppHandle,
    ) -> Result<mpsc::Sender<WatchSignal>, LibraryError> {
        let mut runtime = self
            .watchers
            .runtime
            .lock()
            .map_err(|_| LibraryError::database())?;
        if let Some(sender) = &runtime.sender {
            return Ok(sender.clone());
        }

        let (sender, receiver) = mpsc::channel(SIGNAL_CAPACITY);
        runtime.sender = Some(sender.clone());
        let library = self.clone();
        tauri::async_runtime::spawn(async move {
            library.run_watcher_scheduler(app, receiver).await;
        });
        Ok(sender)
    }

    async fn run_watcher_scheduler(
        &self,
        app: tauri::AppHandle,
        mut receiver: mpsc::Receiver<WatchSignal>,
    ) {
        let mut pending = HashMap::<i64, PendingRefresh>::new();
        let mut interval = tokio::time::interval(SCHEDULER_TICK);
        loop {
            tokio::select! {
                signal = receiver.recv() => {
                    let Some(signal) = signal else { break };
                    schedule_signal(&mut pending, signal, Instant::now());
                }
                _ = interval.tick() => {
                    let overflowed = self.take_overflowed_roots();
                    for root_id in overflowed {
                        schedule_signal(
                            &mut pending,
                            WatchSignal { root_id, reason: SignalReason::Recover },
                            Instant::now(),
                        );
                    }

                    let now = Instant::now();
                    let due = pending
                        .iter()
                        .filter_map(|(root_id, refresh)| (refresh.due_at <= now).then_some(*root_id))
                        .collect::<Vec<_>>();
                    for root_id in due {
                        let Some(refresh) = pending.remove(&root_id) else { continue };
                        if refresh.restart_watcher {
                            let _ = self.set_watch_status(root_id, "degraded").await;
                            let _ = self.restart_watcher(root_id).await;
                        }
                        match self.start_library_refresh(root_id, app.clone()).await {
                            Ok(_) => {}
                            Err(error)
                                if error.code == "library_scan_in_progress"
                                    || error.code == "library_refresh_in_progress" =>
                            {
                                let retry_at = Instant::now() + RETRY_DELAY;
                                pending.insert(
                                    root_id,
                                    PendingRefresh {
                                        first_seen: Instant::now(),
                                        due_at: retry_at,
                                        restart_watcher: false,
                                    },
                                );
                            }
                            Err(_) => {}
                        }
                    }
                }
            }
        }
    }

    async fn install_watcher(
        &self,
        root_id: i64,
        path: PathBuf,
        sender: mpsc::Sender<WatchSignal>,
        replace: bool,
    ) -> Result<(), LibraryError> {
        if !replace
            && self
                .watchers
                .runtime
                .lock()
                .map_err(|_| LibraryError::database())?
                .active
                .contains_key(&root_id)
        {
            return Ok(());
        }

        self.set_watch_status(root_id, "starting").await?;
        self.remove_watcher(root_id)?;
        let overflowed = self.watchers.overflowed.clone();
        let watcher_result =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                let reason = match result {
                    Ok(event) if should_schedule_refresh(&event.kind) => SignalReason::Changed,
                    Ok(_) => return,
                    Err(_) => SignalReason::WatcherError,
                };
                enqueue_signal(&sender, &overflowed, WatchSignal { root_id, reason });
            });

        let mut watcher = match watcher_result {
            Ok(watcher) => watcher,
            Err(_) => {
                self.set_watch_status(root_id, "unavailable").await?;
                return Ok(());
            }
        };
        if watcher.watch(&path, RecursiveMode::Recursive).is_err() {
            self.set_watch_status(root_id, "unavailable").await?;
            return Ok(());
        }
        self.watchers
            .runtime
            .lock()
            .map_err(|_| LibraryError::database())?
            .active
            .insert(root_id, watcher);
        self.set_watch_status(root_id, "watching").await
    }

    async fn restart_watcher(&self, root_id: i64) -> Result<(), LibraryError> {
        let row = sqlx::query("SELECT canonical_path, enabled FROM library_roots WHERE id = ?")
            .bind(root_id)
            .fetch_optional(&self.repository.pool())
            .await
            .map_err(|_| LibraryError::database())?;
        let Some(row) = row else {
            self.remove_watcher(root_id)?;
            return Ok(());
        };
        if row
            .try_get::<i64, _>("enabled")
            .map_err(|_| LibraryError::database())?
            == 0
        {
            self.remove_watcher(root_id)?;
            return self.set_watch_status(root_id, "inactive").await;
        }
        let path = row
            .try_get::<String, _>("canonical_path")
            .map_err(|_| LibraryError::database())?;
        let sender = self
            .watchers
            .runtime
            .lock()
            .map_err(|_| LibraryError::database())?
            .sender
            .clone()
            .ok_or_else(LibraryError::database)?;
        self.install_watcher(root_id, PathBuf::from(path), sender, true)
            .await
    }

    fn remove_watcher(&self, root_id: i64) -> Result<(), LibraryError> {
        self.watchers
            .runtime
            .lock()
            .map_err(|_| LibraryError::database())?
            .active
            .remove(&root_id);
        Ok(())
    }

    fn remove_disabled_watchers(&self, enabled_ids: &HashSet<i64>) -> Result<(), LibraryError> {
        self.watchers
            .runtime
            .lock()
            .map_err(|_| LibraryError::database())?
            .active
            .retain(|root_id, _| enabled_ids.contains(root_id));
        Ok(())
    }

    fn take_overflowed_roots(&self) -> Vec<i64> {
        self.watchers
            .overflowed
            .lock()
            .map(|mut roots| roots.drain().collect())
            .unwrap_or_default()
    }

    async fn set_watch_status(&self, root_id: i64, status: &str) -> Result<(), LibraryError> {
        sqlx::query("UPDATE library_roots SET watch_status = ? WHERE id = ?")
            .bind(status)
            .bind(root_id)
            .execute(&self.repository.pool())
            .await
            .map_err(|_| LibraryError::database())?;
        Ok(())
    }
}

fn should_schedule_refresh(kind: &EventKind) -> bool {
    !matches!(kind, EventKind::Access(_))
}

fn enqueue_signal(
    sender: &mpsc::Sender<WatchSignal>,
    overflowed: &Arc<Mutex<HashSet<i64>>>,
    signal: WatchSignal,
) {
    if matches!(
        sender.try_send(signal),
        Err(mpsc::error::TrySendError::Full(_))
    ) {
        if let Ok(mut roots) = overflowed.lock() {
            roots.insert(signal.root_id);
        }
    }
}

fn schedule_signal(pending: &mut HashMap<i64, PendingRefresh>, signal: WatchSignal, now: Instant) {
    let desired_due = match signal.reason {
        SignalReason::Changed => now + DEBOUNCE_DELAY,
        SignalReason::Recover | SignalReason::WatcherError => now,
    };
    pending
        .entry(signal.root_id)
        .and_modify(|refresh| {
            refresh.due_at = desired_due.min(refresh.first_seen + MAX_DEBOUNCE_DELAY);
            refresh.restart_watcher |= signal.reason == SignalReason::WatcherError;
        })
        .or_insert(PendingRefresh {
            first_seen: now,
            due_at: desired_due,
            restart_watcher: signal.reason == SignalReason::WatcherError,
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, ModifyKind};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn watcher_fixture() -> (LibraryState, tempfile::TempDir, i64) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open watcher fixture database");
        crate::database::NATIVE_MIGRATOR
            .run(&pool)
            .await
            .expect("migrate watcher fixture");
        let directory = tempfile::tempdir().expect("create watcher root");
        let canonical_path = directory
            .path()
            .canonicalize()
            .expect("canonical watcher root")
            .to_string_lossy()
            .into_owned();
        let root_id = sqlx::query_scalar(
            "INSERT INTO library_roots (path, canonical_path) VALUES (?, ?) RETURNING id",
        )
        .bind(&canonical_path)
        .bind(&canonical_path)
        .fetch_one(&pool)
        .await
        .expect("insert watcher root");
        (LibraryState::from_pool(pool), directory, root_id)
    }

    #[test]
    fn access_events_are_ignored_but_catalog_changes_are_scheduled() {
        assert!(!should_schedule_refresh(&EventKind::Access(
            AccessKind::Any
        )));
        assert!(should_schedule_refresh(&EventKind::Create(CreateKind::Any)));
        assert!(should_schedule_refresh(&EventKind::Modify(ModifyKind::Any)));
        assert!(should_schedule_refresh(&EventKind::Remove(
            notify::event::RemoveKind::Any
        )));
    }

    #[test]
    fn debounce_is_bounded_and_recovery_is_immediate() {
        let start = Instant::now();
        let mut pending = HashMap::new();
        schedule_signal(
            &mut pending,
            WatchSignal {
                root_id: 7,
                reason: SignalReason::Changed,
            },
            start,
        );
        assert_eq!(pending[&7].due_at, start + DEBOUNCE_DELAY);

        let later = start + MAX_DEBOUNCE_DELAY;
        schedule_signal(
            &mut pending,
            WatchSignal {
                root_id: 7,
                reason: SignalReason::Changed,
            },
            later,
        );
        assert_eq!(pending[&7].due_at, start + MAX_DEBOUNCE_DELAY);

        schedule_signal(
            &mut pending,
            WatchSignal {
                root_id: 7,
                reason: SignalReason::WatcherError,
            },
            later,
        );
        assert_eq!(pending[&7].due_at, later);
        assert!(pending[&7].restart_watcher);
    }

    #[test]
    fn a_full_signal_channel_coalesces_overflow_by_root() {
        tauri::async_runtime::block_on(async {
            let (sender, mut receiver) = mpsc::channel(1);
            let overflowed = Arc::new(Mutex::new(HashSet::new()));
            let first = WatchSignal {
                root_id: 1,
                reason: SignalReason::Changed,
            };
            let second = WatchSignal {
                root_id: 2,
                reason: SignalReason::Changed,
            };
            enqueue_signal(&sender, &overflowed, first);
            enqueue_signal(&sender, &overflowed, second);
            enqueue_signal(&sender, &overflowed, second);

            assert_eq!(receiver.recv().await, Some(first));
            assert_eq!(
                overflowed
                    .lock()
                    .expect("read overflow roots")
                    .iter()
                    .copied()
                    .collect::<Vec<_>>(),
                vec![2]
            );
        });
    }

    #[test]
    fn watcher_installation_persists_watching_and_unavailable_states() {
        tauri::async_runtime::block_on(async {
            let (state, directory, root_id) = watcher_fixture().await;
            let (sender, _receiver) = mpsc::channel(SIGNAL_CAPACITY);
            state
                .install_watcher(
                    root_id,
                    directory.path().to_path_buf(),
                    sender.clone(),
                    true,
                )
                .await
                .expect("install root watcher");
            assert_eq!(
                state
                    .get_library_root(root_id)
                    .await
                    .expect("read watching root")
                    .watch_status,
                "watching"
            );

            state
                .install_watcher(root_id, directory.path().join("missing"), sender, true)
                .await
                .expect("settle missing root watcher");
            assert_eq!(
                state
                    .get_library_root(root_id)
                    .await
                    .expect("read unavailable root")
                    .watch_status,
                "unavailable"
            );
        });
    }
}

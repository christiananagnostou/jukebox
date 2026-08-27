use super::history::{
    HistorySource, ListeningSample, PlayHistoryError, PlayHistoryMutation, PlayHistoryPage,
    PlayHistoryQuery, PlayHistoryRecorder,
};
use super::persistence::PlaybackRepository;
use crate::library::LibraryState;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;
use tokio::sync::OnceCell;

pub(super) const SNAPSHOT_VERSION: u32 = 1;
const MAX_CONTEXT_TRACKS: usize = 10_000;
const MAX_QUEUE_ENTRIES: usize = 10_000;
const MAX_HISTORY_ENTRIES: usize = 1_000;
const MAX_IDENTIFIER_LENGTH: usize = 128;
const PREVIOUS_RESTART_THRESHOLD_MS: u64 = 10_000;
const POSITION_CHECKPOINT_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackStatus {
    #[default]
    Stopped,
    Paused,
    Playing,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RepeatMode {
    #[default]
    Off,
    One,
    All,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackErrorCode {
    Decoder,
    Output,
    Unavailable,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackFailure {
    code: PlaybackErrorCode,
    recoverable: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    entry_id: String,
    track_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSelection {
    context_index: Option<usize>,
    queue_entry_id: Option<String>,
    resume_context_index: Option<usize>,
    track_id: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackContext {
    cursor: Option<usize>,
    order: Vec<usize>,
    track_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ShuffleState {
    enabled: bool,
    seed: u64,
}

impl Default for ShuffleState {
    fn default() -> Self {
        Self {
            enabled: false,
            seed: 1,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    context: PlaybackContext,
    current: Option<PlaybackSelection>,
    duration_ms: u64,
    error: Option<PlaybackFailure>,
    history: Vec<PlaybackSelection>,
    muted: bool,
    persistence_warning: bool,
    position_ms: u64,
    queue: Vec<QueueEntry>,
    repeat_mode: RepeatMode,
    revision: u64,
    schema_version: u32,
    shuffle: ShuffleState,
    status: PlaybackStatus,
    transition_pending: bool,
    volume_percent: u8,
}

impl Default for PlaybackSnapshot {
    fn default() -> Self {
        Self {
            context: PlaybackContext::default(),
            current: None,
            duration_ms: 0,
            error: None,
            history: Vec::new(),
            muted: false,
            persistence_warning: false,
            position_ms: 0,
            queue: Vec::new(),
            repeat_mode: RepeatMode::Off,
            revision: 0,
            schema_version: SNAPSHOT_VERSION,
            shuffle: ShuffleState::default(),
            status: PlaybackStatus::Stopped,
            transition_pending: false,
            volume_percent: 100,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackCommandRequest {
    command: PlaybackCommand,
    expected_revision: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackPositionObservation {
    duration_ms: u64,
    expected_revision: u64,
    position_ms: u64,
    track_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackPositionState {
    duration_ms: u64,
    position_ms: u64,
    revision: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlaybackCommand {
    ReplaceContext {
        autoplay: bool,
        start_index: usize,
        track_ids: Vec<String>,
    },
    Enqueue {
        entries: Vec<QueueEntry>,
    },
    RemoveQueueEntry {
        entry_id: String,
    },
    MoveQueueEntry {
        before_entry_id: Option<String>,
        entry_id: String,
    },
    ClearUpcoming,
    Play,
    Pause,
    Seek {
        position_ms: u64,
    },
    UpdateDuration {
        duration_ms: u64,
    },
    Next,
    Previous,
    Ended,
    SetRepeat {
        repeat_mode: RepeatMode,
    },
    SetShuffle {
        enabled: bool,
        seed: u64,
    },
    MarkUnavailable {
        track_id: String,
    },
    ReportError {
        code: PlaybackErrorCode,
        recoverable: bool,
    },
    CommitTransition,
    RejectTransition {
        code: PlaybackErrorCode,
        recoverable: bool,
    },
    ClearError,
    SetVolume {
        muted: bool,
        volume_percent: u8,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackCommandError {
    code: &'static str,
    current_revision: u64,
    message: &'static str,
}

impl PlaybackCommandError {
    fn stale(current_revision: u64) -> Self {
        Self {
            code: "stale_revision",
            current_revision,
            message: "Playback state changed; reload the latest snapshot and retry.",
        }
    }

    fn invalid(current_revision: u64, message: &'static str) -> Self {
        Self {
            code: "invalid_command",
            current_revision,
            message,
        }
    }

    fn unavailable() -> Self {
        Self {
            code: "state_unavailable",
            current_revision: 0,
            message: "Playback state is temporarily unavailable.",
        }
    }

    fn transition_pending(current_revision: u64) -> Self {
        Self {
            code: "transition_pending",
            current_revision,
            message: "Finish the pending playback transition before changing state.",
        }
    }

    fn no_transition(current_revision: u64) -> Self {
        Self {
            code: "no_pending_transition",
            current_revision,
            message: "There is no playback transition to finish.",
        }
    }
}

#[derive(Default)]
struct PlaybackMachine {
    rollback: Option<PlaybackSnapshot>,
    snapshot: PlaybackSnapshot,
}

pub struct PlaybackState {
    checkpoint: Mutex<Option<Instant>>,
    history: Option<PlayHistoryRecorder>,
    machine: Mutex<PlaybackMachine>,
    repository: Option<PlaybackRepository>,
    restored: OnceCell<()>,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            checkpoint: Mutex::new(None),
            history: None,
            machine: Mutex::new(PlaybackMachine::default()),
            repository: None,
            restored: OnceCell::new(),
        }
    }
}

impl PlaybackState {
    pub fn new(pool: sqlx::SqlitePool) -> Self {
        Self {
            checkpoint: Mutex::new(None),
            history: Some(PlayHistoryRecorder::new(pool.clone())),
            machine: Mutex::new(PlaybackMachine::default()),
            repository: Some(PlaybackRepository::new(pool)),
            restored: OnceCell::new(),
        }
    }

    async fn ensure_restored(&self) {
        self.restored
            .get_or_init(|| async {
                let Some(repository) = &self.repository else {
                    return;
                };
                let restored = repository.load().await;
                if restored
                    .as_ref()
                    .is_err_and(|error| error.code == "invalid_playback_session")
                {
                    let _ = repository.discard().await;
                }
                let Ok(mut machine) = self.machine.lock() else {
                    return;
                };
                match restored {
                    Ok(Some(snapshot)) => machine.snapshot = snapshot,
                    Ok(None) => {}
                    Err(_) => machine.snapshot.persistence_warning = true,
                }
            })
            .await;
    }

    async fn persist(&self, snapshot: PlaybackSnapshot) {
        let Some(repository) = &self.repository else {
            return;
        };
        let revision = snapshot.revision;
        let failed = repository.save(&snapshot).await.is_err();
        if let Ok(mut machine) = self.machine.lock() {
            if machine.snapshot.revision == revision {
                machine.snapshot.persistence_warning = failed;
            }
        }
    }

    fn checkpoint_due(&self) -> bool {
        let Ok(mut checkpoint) = self.checkpoint.lock() else {
            return false;
        };
        let now = Instant::now();
        if checkpoint.is_some_and(|previous| {
            now.saturating_duration_since(previous) < POSITION_CHECKPOINT_INTERVAL
        }) {
            return false;
        }
        *checkpoint = Some(now);
        true
    }

    fn snapshot(&self) -> Result<PlaybackSnapshot, PlaybackCommandError> {
        self.machine
            .lock()
            .map(|machine| machine.snapshot.clone())
            .map_err(|_| PlaybackCommandError::unavailable())
    }

    fn record_command_history(
        &self,
        command: &PlaybackCommand,
        before: &PlaybackSnapshot,
        after: &PlaybackSnapshot,
    ) {
        let Some(history) = &self.history else {
            return;
        };
        match command {
            PlaybackCommand::CommitTransition | PlaybackCommand::Play => {
                if let Some(sample) = after.listening_sample() {
                    history.started(sample);
                }
            }
            PlaybackCommand::Pause => {
                if let Some(sample) = after.listening_sample() {
                    history.observe(sample, true);
                }
            }
            PlaybackCommand::ReplaceContext { .. }
            | PlaybackCommand::Next
            | PlaybackCommand::Ended
            | PlaybackCommand::ReportError { .. } => {
                history.finish(before.listening_sample());
            }
            PlaybackCommand::Previous | PlaybackCommand::MarkUnavailable { .. }
                if before.current != after.current =>
            {
                history.finish(before.listening_sample());
            }
            _ => {}
        }
    }

    fn record_position_history(&self, snapshot: &PlaybackSnapshot, persist: bool) {
        if let (Some(history), Some(sample)) = (&self.history, snapshot.listening_sample()) {
            history.observe(sample, persist);
        }
    }

    fn dispatch(
        &self,
        request: PlaybackCommandRequest,
    ) -> Result<PlaybackSnapshot, PlaybackCommandError> {
        let mut machine = self
            .machine
            .lock()
            .map_err(|_| PlaybackCommandError::unavailable())?;
        if request.expected_revision != machine.snapshot.revision {
            return Err(PlaybackCommandError::stale(machine.snapshot.revision));
        }

        match request.command {
            PlaybackCommand::CommitTransition => return machine.commit_transition(),
            PlaybackCommand::RejectTransition { code, recoverable } => {
                return machine.reject_transition(code, recoverable)
            }
            _ if machine.rollback.is_some() => {
                return Err(PlaybackCommandError::transition_pending(
                    machine.snapshot.revision,
                ))
            }
            _ => {}
        }

        let previous = machine.snapshot.clone();
        let previous_current = previous.current.clone();
        let requires_confirmation = request.command.requires_transition_confirmation();
        let mut next = previous.clone();
        let changed = next.apply(request.command)?;
        if changed {
            next.revision = next.revision.saturating_add(1);
            if requires_confirmation && next.current.is_some() && next.current != previous_current {
                next.transition_pending = true;
                machine.rollback = Some(previous);
            }
            machine.snapshot = next;
        }
        Ok(machine.snapshot.clone())
    }

    fn dispatch_with_history(
        &self,
        request: PlaybackCommandRequest,
    ) -> Result<PlaybackSnapshot, PlaybackCommandError> {
        let command = request.command.clone();
        let previous = self.snapshot()?;
        let snapshot = self.dispatch(request)?;
        self.record_command_history(&command, &previous, &snapshot);
        Ok(snapshot)
    }

    fn observe_position(
        &self,
        observation: PlaybackPositionObservation,
    ) -> Result<PlaybackPositionState, PlaybackCommandError> {
        let mut machine = self
            .machine
            .lock()
            .map_err(|_| PlaybackCommandError::unavailable())?;
        if observation.expected_revision != machine.snapshot.revision {
            return Err(PlaybackCommandError::stale(machine.snapshot.revision));
        }
        if machine.rollback.is_some() {
            return Err(PlaybackCommandError::transition_pending(
                machine.snapshot.revision,
            ));
        }
        validate_id(&observation.track_id, machine.snapshot.revision)?;
        if machine
            .snapshot
            .current
            .as_ref()
            .is_none_or(|current| current.track_id != observation.track_id)
        {
            return Err(PlaybackCommandError::invalid(
                machine.snapshot.revision,
                "The position observation does not match the current track.",
            ));
        }

        let position_ms = observation.position_ms.min(observation.duration_ms);
        if machine.snapshot.duration_ms != observation.duration_ms
            || machine.snapshot.position_ms != position_ms
        {
            machine.snapshot.duration_ms = observation.duration_ms;
            machine.snapshot.position_ms = position_ms;
            machine.snapshot.revision = machine.snapshot.revision.saturating_add(1);
        }
        Ok(PlaybackPositionState {
            duration_ms: machine.snapshot.duration_ms,
            position_ms: machine.snapshot.position_ms,
            revision: machine.snapshot.revision,
        })
    }
}

impl PlaybackMachine {
    fn commit_transition(&mut self) -> Result<PlaybackSnapshot, PlaybackCommandError> {
        if self.rollback.take().is_none() {
            return Err(PlaybackCommandError::no_transition(self.snapshot.revision));
        }
        self.snapshot.transition_pending = false;
        self.snapshot.revision = self.snapshot.revision.saturating_add(1);
        Ok(self.snapshot.clone())
    }

    fn reject_transition(
        &mut self,
        code: PlaybackErrorCode,
        recoverable: bool,
    ) -> Result<PlaybackSnapshot, PlaybackCommandError> {
        let Some(mut rollback) = self.rollback.take() else {
            return Err(PlaybackCommandError::no_transition(self.snapshot.revision));
        };
        rollback.revision = self.snapshot.revision.saturating_add(1);
        rollback.error = Some(PlaybackFailure { code, recoverable });
        rollback.status = PlaybackStatus::Paused;
        rollback.transition_pending = false;
        self.snapshot = rollback;
        Ok(self.snapshot.clone())
    }
}

#[tauri::command]
pub async fn get_playback_snapshot(
    library: State<'_, LibraryState>,
    state: State<'_, PlaybackState>,
) -> Result<PlaybackSnapshot, PlaybackCommandError> {
    library
        .ensure_initialized()
        .await
        .map_err(|_| PlaybackCommandError::unavailable())?;
    state.ensure_restored().await;
    state.snapshot()
}

#[tauri::command]
pub async fn dispatch_playback_command(
    library: State<'_, LibraryState>,
    state: State<'_, PlaybackState>,
    request: PlaybackCommandRequest,
) -> Result<PlaybackSnapshot, PlaybackCommandError> {
    library
        .ensure_initialized()
        .await
        .map_err(|_| PlaybackCommandError::unavailable())?;
    state.ensure_restored().await;
    let expected_revision = request.expected_revision;
    let persist_immediately = request.command.persists_immediately();
    let snapshot = state.dispatch_with_history(request)?;
    if persist_immediately && snapshot.revision > expected_revision && !snapshot.transition_pending
    {
        state.persist(snapshot).await;
        return state.snapshot();
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn observe_playback_position(
    library: State<'_, LibraryState>,
    state: State<'_, PlaybackState>,
    observation: PlaybackPositionObservation,
) -> Result<PlaybackPositionState, PlaybackCommandError> {
    library
        .ensure_initialized()
        .await
        .map_err(|_| PlaybackCommandError::unavailable())?;
    state.ensure_restored().await;
    let expected_revision = observation.expected_revision;
    let position = state.observe_position(observation)?;
    let checkpoint_due = position.revision > expected_revision && state.checkpoint_due();
    let snapshot = state.snapshot()?;
    state.record_position_history(&snapshot, checkpoint_due);
    if checkpoint_due {
        state.persist(snapshot).await;
    }
    Ok(position)
}

#[tauri::command]
pub async fn list_play_history(
    library: State<'_, LibraryState>,
    state: State<'_, PlaybackState>,
    query: PlayHistoryQuery,
) -> Result<PlayHistoryPage, PlayHistoryError> {
    library
        .ensure_initialized()
        .await
        .map_err(|_| PlayHistoryError::unavailable())?;
    state.ensure_restored().await;
    state
        .history
        .as_ref()
        .ok_or_else(PlayHistoryError::unavailable)?
        .page(query)
        .await
}

#[tauri::command]
pub async fn clear_play_history(
    library: State<'_, LibraryState>,
    state: State<'_, PlaybackState>,
) -> Result<PlayHistoryMutation, PlayHistoryError> {
    library
        .ensure_initialized()
        .await
        .map_err(|_| PlayHistoryError::unavailable())?;
    state.ensure_restored().await;
    state
        .history
        .as_ref()
        .ok_or_else(PlayHistoryError::unavailable)?
        .clear()
        .await
}

impl PlaybackSnapshot {
    fn listening_sample(&self) -> Option<ListeningSample> {
        let current = self.current.as_ref()?;
        let (instance_key, source) = if let Some(entry_id) = current.queue_entry_id.as_deref() {
            (format!("queue:{entry_id}"), HistorySource::Queue)
        } else {
            (
                format!(
                    "context:{}:{}",
                    current.context_index.unwrap_or_default(),
                    current.track_id
                ),
                HistorySource::Context,
            )
        };
        Some(ListeningSample {
            duration_ms: self.duration_ms,
            instance_key,
            playing: self.status == PlaybackStatus::Playing,
            position_ms: self.position_ms,
            source,
            track_id: current.track_id.clone(),
        })
    }

    pub(super) fn committed_for_persistence(&self) -> Result<Self, &'static str> {
        self.validate_persisted()?;
        let mut snapshot = self.clone();
        snapshot.error = None;
        snapshot.persistence_warning = false;
        Ok(snapshot)
    }

    pub(super) fn restored_from_persistence(
        mut self,
        available: &HashSet<String>,
    ) -> Result<Self, &'static str> {
        self.validate_persisted()?;
        self.revision = u64::try_from(
            self.persistence_revision()?
                .checked_add(1)
                .ok_or("The playback revision is too large to restore.")?,
        )
        .map_err(|_| "The playback revision is too large to restore.")?;
        let pruned = self.retain_available(available);
        self.status = if self.current.is_some() {
            PlaybackStatus::Paused
        } else {
            PlaybackStatus::Stopped
        };
        self.persistence_warning = pruned;
        self.validate_persisted()?;
        Ok(self)
    }

    pub(super) fn referenced_track_ids(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        self.context
            .track_ids
            .iter()
            .chain(self.queue.iter().map(|entry| &entry.track_id))
            .chain(self.history.iter().map(|entry| &entry.track_id))
            .chain(self.current.iter().map(|current| &current.track_id))
            .filter(|track_id| seen.insert(track_id.as_str()))
            .cloned()
            .collect()
    }

    pub(super) fn needs_recovery_checkpoint(&self) -> bool {
        self.persistence_warning
    }

    fn retain_available(&mut self, available: &HashSet<String>) -> bool {
        let original_context = self.context.clone();
        let original_current = self.current.clone();
        let original_queue_len = self.queue.len();
        let original_history_len = self.history.len();
        let mut index_map = vec![None; original_context.track_ids.len()];
        let mut track_ids = Vec::with_capacity(original_context.track_ids.len());
        for (old_index, track_id) in original_context.track_ids.iter().enumerate() {
            if available.contains(track_id) {
                index_map[old_index] = Some(track_ids.len());
                track_ids.push(track_id.clone());
            }
        }
        let order = original_context
            .order
            .iter()
            .filter_map(|old_index| index_map.get(*old_index).copied().flatten())
            .collect::<Vec<_>>();
        let cursor_for_old_index = |old_index: usize| {
            index_map
                .get(old_index)
                .copied()
                .flatten()
                .and_then(|new_index| order.iter().position(|candidate| *candidate == new_index))
        };
        let nearest_cursor = |old_cursor: Option<usize>| {
            old_cursor
                .and_then(|cursor| {
                    original_context
                        .order
                        .iter()
                        .skip(cursor)
                        .find_map(|old_index| cursor_for_old_index(*old_index))
                })
                .or_else(|| (!order.is_empty()).then_some(0))
        };

        self.context.track_ids = track_ids;
        self.context.order = order.clone();
        self.queue
            .retain(|entry| available.contains(&entry.track_id));
        self.history
            .retain(|selection| available.contains(&selection.track_id));
        for selection in &mut self.history {
            selection.context_index = selection
                .context_index
                .and_then(|old_index| index_map.get(old_index).copied().flatten());
            selection.resume_context_index = selection
                .resume_context_index
                .and_then(|old_index| index_map.get(old_index).copied().flatten());
        }

        let current_was_missing = original_current
            .as_ref()
            .is_some_and(|selection| !available.contains(&selection.track_id));
        if let Some(mut current) = self
            .current
            .take()
            .filter(|selection| available.contains(&selection.track_id))
        {
            current.context_index = current
                .context_index
                .and_then(|old_index| index_map.get(old_index).copied().flatten());
            current.resume_context_index = current
                .resume_context_index
                .and_then(|old_index| index_map.get(old_index).copied().flatten());
            self.context.cursor = current
                .context_index
                .or(current.resume_context_index)
                .and_then(|new_index| {
                    self.context
                        .order
                        .iter()
                        .position(|candidate| *candidate == new_index)
                })
                .or_else(|| nearest_cursor(original_context.cursor));
            self.current = Some(current);
        } else if current_was_missing {
            self.context.cursor = nearest_cursor(original_context.cursor);
            self.current = self.queue.first().cloned().map(|entry| {
                self.queue.remove(0);
                PlaybackSelection {
                    context_index: None,
                    queue_entry_id: Some(entry.entry_id),
                    resume_context_index: self.context_current_index(),
                    track_id: entry.track_id,
                }
            });
            if self.current.is_none() {
                self.current = self.context_selection();
            }
            self.position_ms = 0;
            self.duration_ms = 0;
        } else {
            self.context.cursor = nearest_cursor(original_context.cursor);
            self.current = None;
        }

        let pruned = self.context != original_context
            || self.current != original_current
            || self.queue.len() != original_queue_len
            || self.history.len() != original_history_len;
        if pruned {
            self.error = Some(PlaybackFailure {
                code: PlaybackErrorCode::Unavailable,
                recoverable: true,
            });
        }
        pruned
    }

    pub(super) fn persistence_revision(&self) -> Result<i64, &'static str> {
        i64::try_from(self.revision).map_err(|_| "The playback revision is too large to persist.")
    }

    fn validate_persisted(&self) -> Result<(), &'static str> {
        if self.schema_version != SNAPSHOT_VERSION {
            return Err("The playback snapshot version is unsupported.");
        }
        self.persistence_revision()?;
        if self.transition_pending {
            return Err("A pending playback transition cannot be persisted.");
        }
        if self.context.track_ids.len() > MAX_CONTEXT_TRACKS
            || self.context.order.len() != self.context.track_ids.len()
        {
            return Err("The persisted playback context is invalid.");
        }
        if self.queue.len() > MAX_QUEUE_ENTRIES || self.history.len() > MAX_HISTORY_ENTRIES {
            return Err("The persisted playback collections are too large.");
        }
        if self.volume_percent > 100 || self.position_ms > self.duration_ms {
            return Err("The persisted playback values are out of range.");
        }
        if self
            .context
            .track_ids
            .iter()
            .any(|track_id| !is_valid_id(track_id))
        {
            return Err("The persisted playback context contains an invalid identifier.");
        }

        let mut seen_order = vec![false; self.context.track_ids.len()];
        for index in &self.context.order {
            let Some(seen) = seen_order.get_mut(*index) else {
                return Err("The persisted playback order is invalid.");
            };
            if *seen {
                return Err("The persisted playback order contains duplicates.");
            }
            *seen = true;
        }
        if self
            .context
            .cursor
            .is_some_and(|cursor| cursor >= self.context.order.len())
        {
            return Err("The persisted playback cursor is invalid.");
        }

        let mut queue_ids = HashSet::with_capacity(self.queue.len());
        for entry in &self.queue {
            if !is_valid_id(&entry.entry_id)
                || !is_valid_id(&entry.track_id)
                || !queue_ids.insert(entry.entry_id.as_str())
            {
                return Err("The persisted playback queue is invalid.");
            }
        }
        if let Some(current) = &self.current {
            self.validate_selection(current)?;
            if current.context_index.is_some()
                && current.context_index != self.context_current_index()
            {
                return Err("The persisted current selection does not match its context cursor.");
            }
            if current.queue_entry_id.is_some()
                && current.resume_context_index != self.context_current_index()
            {
                return Err("The persisted queued selection has an invalid context anchor.");
            }
            if current
                .queue_entry_id
                .as_deref()
                .is_some_and(|entry_id| queue_ids.contains(entry_id))
            {
                return Err("The current queue entry is still present in the upcoming queue.");
            }
        }
        for selection in &self.history {
            self.validate_selection(selection)?;
        }
        Ok(())
    }

    fn validate_selection(&self, selection: &PlaybackSelection) -> Result<(), &'static str> {
        if !is_valid_id(&selection.track_id) {
            return Err("A persisted playback selection has an invalid track identifier.");
        }
        match (
            selection.context_index,
            selection.queue_entry_id.as_deref(),
            selection.resume_context_index,
        ) {
            (Some(context_index), None, None)
                if self.context.track_ids.get(context_index) == Some(&selection.track_id) =>
            {
                Ok(())
            }
            (None, Some(entry_id), resume_context_index)
                if is_valid_id(entry_id)
                    && resume_context_index
                        .is_none_or(|index| index < self.context.track_ids.len()) =>
            {
                Ok(())
            }
            _ => Err("A persisted playback selection is structurally invalid."),
        }
    }

    fn apply(&mut self, command: PlaybackCommand) -> Result<bool, PlaybackCommandError> {
        match command {
            PlaybackCommand::ReplaceContext {
                autoplay,
                start_index,
                track_ids,
            } => self.replace_context(track_ids, start_index, autoplay),
            PlaybackCommand::Enqueue { entries } => self.enqueue(entries),
            PlaybackCommand::RemoveQueueEntry { entry_id } => self.remove_queue_entry(&entry_id),
            PlaybackCommand::MoveQueueEntry {
                before_entry_id,
                entry_id,
            } => self.move_queue_entry(&entry_id, before_entry_id.as_deref()),
            PlaybackCommand::ClearUpcoming => Ok(if self.queue.is_empty() {
                false
            } else {
                self.queue.clear();
                true
            }),
            PlaybackCommand::Play => Ok(
                if self.current.is_some() && self.status != PlaybackStatus::Playing {
                    self.status = PlaybackStatus::Playing;
                    self.error = None;
                    true
                } else {
                    false
                },
            ),
            PlaybackCommand::Pause => Ok(if self.status == PlaybackStatus::Playing {
                self.status = PlaybackStatus::Paused;
                true
            } else {
                false
            }),
            PlaybackCommand::Seek { position_ms } => {
                let position_ms = position_ms.min(self.duration_ms);
                Ok(if self.position_ms == position_ms {
                    false
                } else {
                    self.position_ms = position_ms;
                    true
                })
            }
            PlaybackCommand::UpdateDuration { duration_ms } => {
                Ok(if self.duration_ms == duration_ms {
                    false
                } else {
                    self.duration_ms = duration_ms;
                    self.position_ms = self.position_ms.min(duration_ms);
                    true
                })
            }
            PlaybackCommand::Next => Ok(self.advance(true)),
            PlaybackCommand::Previous => Ok(self.previous()),
            PlaybackCommand::Ended => Ok(
                if self.repeat_mode == RepeatMode::One && self.current.is_some() {
                    self.position_ms = 0;
                    self.error = None;
                    true
                } else {
                    self.advance(true)
                },
            ),
            PlaybackCommand::SetRepeat { repeat_mode } => Ok(if self.repeat_mode == repeat_mode {
                false
            } else {
                self.repeat_mode = repeat_mode;
                true
            }),
            PlaybackCommand::SetShuffle { enabled, seed } => self.set_shuffle(enabled, seed),
            PlaybackCommand::MarkUnavailable { track_id } => self.mark_unavailable(&track_id),
            PlaybackCommand::ReportError { code, recoverable } => {
                let failure = PlaybackFailure { code, recoverable };
                Ok(
                    if self.error.as_ref() == Some(&failure)
                        && self.status == PlaybackStatus::Paused
                    {
                        false
                    } else {
                        self.error = Some(failure);
                        self.status = PlaybackStatus::Paused;
                        true
                    },
                )
            }
            PlaybackCommand::CommitTransition | PlaybackCommand::RejectTransition { .. } => {
                unreachable!("transition commands are handled by PlaybackMachine")
            }
            PlaybackCommand::ClearError => Ok(self.error.take().is_some()),
            PlaybackCommand::SetVolume {
                muted,
                volume_percent,
            } => {
                if volume_percent > 100 {
                    return Err(PlaybackCommandError::invalid(
                        self.revision,
                        "Volume must be between 0 and 100.",
                    ));
                }
                Ok(
                    if self.muted == muted && self.volume_percent == volume_percent {
                        false
                    } else {
                        self.muted = muted;
                        self.volume_percent = volume_percent;
                        true
                    },
                )
            }
        }
    }

    fn replace_context(
        &mut self,
        track_ids: Vec<String>,
        start_index: usize,
        autoplay: bool,
    ) -> Result<bool, PlaybackCommandError> {
        validate_ids(&track_ids, MAX_CONTEXT_TRACKS, self.revision)?;
        if track_ids.is_empty() {
            if start_index != 0 {
                return Err(PlaybackCommandError::invalid(
                    self.revision,
                    "An empty context must start at index zero.",
                ));
            }
        } else if start_index >= track_ids.len() {
            return Err(PlaybackCommandError::invalid(
                self.revision,
                "The start index is outside the playback context.",
            ));
        }

        let order = playback_order(track_ids.len(), self.shuffle.enabled, self.shuffle.seed);
        let cursor = (!track_ids.is_empty()).then(|| {
            order
                .iter()
                .position(|index| *index == start_index)
                .expect("playback order contains every context index")
        });
        self.context = PlaybackContext {
            cursor,
            order,
            track_ids,
        };
        self.current = self.context_selection();
        self.history.clear();
        self.position_ms = 0;
        self.duration_ms = 0;
        self.error = None;
        self.status = if self.current.is_none() {
            PlaybackStatus::Stopped
        } else if autoplay {
            PlaybackStatus::Playing
        } else {
            PlaybackStatus::Paused
        };
        Ok(true)
    }

    fn enqueue(&mut self, entries: Vec<QueueEntry>) -> Result<bool, PlaybackCommandError> {
        if entries.is_empty() {
            return Ok(false);
        }
        if self.queue.len().saturating_add(entries.len()) > MAX_QUEUE_ENTRIES {
            return Err(PlaybackCommandError::invalid(
                self.revision,
                "The playback queue is full.",
            ));
        }
        for entry in &entries {
            validate_id(&entry.entry_id, self.revision)?;
            validate_id(&entry.track_id, self.revision)?;
        }
        let mut entry_ids = self
            .queue
            .iter()
            .map(|entry| entry.entry_id.as_str())
            .collect::<HashSet<_>>();
        for entry in &entries {
            if !entry_ids.insert(entry.entry_id.as_str()) {
                return Err(PlaybackCommandError::invalid(
                    self.revision,
                    "Queue entry IDs must be unique.",
                ));
            }
        }
        self.queue.extend(entries);
        Ok(true)
    }

    fn remove_queue_entry(&mut self, entry_id: &str) -> Result<bool, PlaybackCommandError> {
        validate_id(entry_id, self.revision)?;
        let original_len = self.queue.len();
        self.queue.retain(|entry| entry.entry_id != entry_id);
        Ok(self.queue.len() != original_len)
    }

    fn move_queue_entry(
        &mut self,
        entry_id: &str,
        before_entry_id: Option<&str>,
    ) -> Result<bool, PlaybackCommandError> {
        validate_id(entry_id, self.revision)?;
        if let Some(before_entry_id) = before_entry_id {
            validate_id(before_entry_id, self.revision)?;
            if entry_id == before_entry_id {
                return Ok(false);
            }
        }
        let Some(from) = self
            .queue
            .iter()
            .position(|entry| entry.entry_id == entry_id)
        else {
            return Ok(false);
        };
        let entry = self.queue.remove(from);
        let to = match before_entry_id {
            Some(target) => self
                .queue
                .iter()
                .position(|candidate| candidate.entry_id == target)
                .ok_or_else(|| {
                    PlaybackCommandError::invalid(
                        self.revision,
                        "The target queue entry does not exist.",
                    )
                })?,
            None => self.queue.len(),
        };
        self.queue.insert(to, entry);
        Ok(from != to)
    }

    fn set_shuffle(&mut self, enabled: bool, seed: u64) -> Result<bool, PlaybackCommandError> {
        let seed = seed.max(1);
        if self.shuffle.enabled == enabled && self.shuffle.seed == seed {
            return Ok(false);
        }
        let current_context_index = self
            .current
            .as_ref()
            .and_then(|current| current.context_index.or(current.resume_context_index))
            .or_else(|| self.context_current_index());
        self.shuffle = ShuffleState { enabled, seed };
        self.context.order = playback_order(self.context.track_ids.len(), enabled, seed);
        self.context.cursor = current_context_index.and_then(|current| {
            self.context
                .order
                .iter()
                .position(|candidate| *candidate == current)
        });
        if let Some(current) = self.current.as_mut() {
            if current.queue_entry_id.is_some() {
                current.resume_context_index = current_context_index;
            }
        }
        Ok(true)
    }

    fn mark_unavailable(&mut self, track_id: &str) -> Result<bool, PlaybackCommandError> {
        validate_id(track_id, self.revision)?;
        let queue_len = self.queue.len();
        self.queue.retain(|entry| entry.track_id != track_id);
        let queue_changed = queue_len != self.queue.len();
        let old_order = self.context.order.clone();
        let old_track_ids = self.context.track_ids.clone();
        let old_cursor = self.context.cursor;
        let mut new_track_ids = Vec::with_capacity(old_track_ids.len());
        let mut index_map = vec![None; old_track_ids.len()];
        for (old_index, candidate) in old_track_ids.into_iter().enumerate() {
            if candidate != track_id {
                index_map[old_index] = Some(new_track_ids.len());
                new_track_ids.push(candidate);
            }
        }
        let context_changed = new_track_ids.len() != self.context.track_ids.len();
        let new_order = old_order
            .iter()
            .filter_map(|old_index| index_map.get(*old_index).copied().flatten())
            .collect::<Vec<_>>();
        let current_unavailable = self
            .current
            .as_ref()
            .is_some_and(|current| current.track_id == track_id);
        let current_context_index = self
            .current
            .as_ref()
            .and_then(|current| current.context_index);
        let current_resume_context_index = self
            .current
            .as_ref()
            .and_then(|current| current.resume_context_index);
        if !current_unavailable && !queue_changed && !context_changed {
            return Ok(false);
        }
        self.context.track_ids = new_track_ids;
        self.context.order = new_order;
        self.history.retain(|entry| entry.track_id != track_id);
        for entry in &mut self.history {
            entry.context_index = entry
                .context_index
                .and_then(|old_index| index_map.get(old_index).copied().flatten());
            entry.resume_context_index = entry
                .resume_context_index
                .and_then(|old_index| index_map.get(old_index).copied().flatten());
        }
        if current_unavailable {
            self.current = None;
            self.context.cursor = if current_context_index.is_some() {
                let remaining_before = old_cursor.map_or(0, |cursor| {
                    old_order
                        .iter()
                        .take(cursor)
                        .filter(|old_index| index_map.get(**old_index).is_some_and(Option::is_some))
                        .count()
                });
                remaining_before.checked_sub(1)
            } else {
                current_resume_context_index
                    .and_then(|old_index| index_map.get(old_index).copied().flatten())
                    .and_then(|new_index| {
                        self.context
                            .order
                            .iter()
                            .position(|candidate| *candidate == new_index)
                    })
            };
            self.position_ms = 0;
            self.duration_ms = 0;
            self.error = Some(PlaybackFailure {
                code: PlaybackErrorCode::Unavailable,
                recoverable: true,
            });
            if !self.queue.is_empty() {
                let entry = self.queue.remove(0);
                self.current = Some(PlaybackSelection {
                    context_index: None,
                    queue_entry_id: Some(entry.entry_id),
                    resume_context_index: self.context_current_index(),
                    track_id: entry.track_id,
                });
                self.status = PlaybackStatus::Playing;
            } else {
                self.select_next_context(true);
            }
        } else if let Some(current) = self.current.as_mut() {
            current.context_index = current_context_index
                .and_then(|old_index| index_map.get(old_index).copied().flatten());
            current.resume_context_index = current_resume_context_index
                .and_then(|old_index| index_map.get(old_index).copied().flatten());
            if let Some(anchor) = current.context_index.or(current.resume_context_index) {
                self.context.cursor = self
                    .context
                    .order
                    .iter()
                    .position(|candidate| *candidate == anchor);
            }
        }
        Ok(true)
    }

    fn previous(&mut self) -> bool {
        if self.current.is_none() {
            return false;
        }
        if self.position_ms > PREVIOUS_RESTART_THRESHOLD_MS {
            self.position_ms = 0;
            self.error = None;
            return true;
        }
        let Some(previous) = self.history.pop() else {
            if self.position_ms == 0 {
                return false;
            }
            self.position_ms = 0;
            return true;
        };
        if let Some(current) = self.current.as_ref() {
            if let Some(entry_id) = current.queue_entry_id.as_ref() {
                self.queue.insert(
                    0,
                    QueueEntry {
                        entry_id: entry_id.clone(),
                        track_id: current.track_id.clone(),
                    },
                );
            }
        }
        if let Some(context_index) = previous.context_index.or(previous.resume_context_index) {
            self.context.cursor = self
                .context
                .order
                .iter()
                .position(|candidate| *candidate == context_index);
        }
        self.current = Some(previous);
        self.position_ms = 0;
        self.duration_ms = 0;
        self.error = None;
        self.status = PlaybackStatus::Playing;
        true
    }

    fn advance(&mut self, from_ended: bool) -> bool {
        if let Some(current) = self.current.take() {
            self.history.push(current);
            if self.history.len() > MAX_HISTORY_ENTRIES {
                self.history.remove(0);
            }
        }
        self.position_ms = 0;
        self.duration_ms = 0;
        self.error = None;

        if !self.queue.is_empty() {
            let entry = self.queue.remove(0);
            self.current = Some(PlaybackSelection {
                context_index: None,
                queue_entry_id: Some(entry.entry_id),
                resume_context_index: self.context_current_index(),
                track_id: entry.track_id,
            });
            self.status = PlaybackStatus::Playing;
            return true;
        }

        self.select_next_context(from_ended)
    }

    fn select_next_context(&mut self, allow_repeat: bool) -> bool {
        let next_cursor = match self.context.cursor {
            Some(cursor) if cursor + 1 < self.context.order.len() => Some(cursor + 1),
            Some(_) if allow_repeat && self.repeat_mode == RepeatMode::All => Some(0),
            None if !self.context.order.is_empty() => Some(0),
            _ => None,
        };
        self.context.cursor = next_cursor;
        self.current = self.context_selection();
        self.status = if self.current.is_some() {
            PlaybackStatus::Playing
        } else {
            PlaybackStatus::Stopped
        };
        true
    }

    fn context_selection(&self) -> Option<PlaybackSelection> {
        let context_index = *self.context.order.get(self.context.cursor?)?;
        Some(PlaybackSelection {
            context_index: Some(context_index),
            queue_entry_id: None,
            resume_context_index: None,
            track_id: self.context.track_ids.get(context_index)?.clone(),
        })
    }

    fn context_current_index(&self) -> Option<usize> {
        self.context
            .cursor
            .and_then(|cursor| self.context.order.get(cursor).copied())
    }
}

impl PlaybackCommand {
    fn persists_immediately(&self) -> bool {
        matches!(
            self,
            Self::ReplaceContext { .. }
                | Self::Enqueue { .. }
                | Self::RemoveQueueEntry { .. }
                | Self::MoveQueueEntry { .. }
                | Self::ClearUpcoming
                | Self::Play
                | Self::Pause
                | Self::Next
                | Self::Previous
                | Self::Ended
                | Self::SetRepeat { .. }
                | Self::SetShuffle { .. }
                | Self::MarkUnavailable { .. }
                | Self::CommitTransition
                | Self::SetVolume { .. }
        )
    }

    fn requires_transition_confirmation(&self) -> bool {
        match self {
            Self::ReplaceContext { autoplay, .. } => *autoplay,
            Self::Next | Self::Previous | Self::Ended | Self::MarkUnavailable { .. } => true,
            _ => false,
        }
    }
}

fn validate_ids(ids: &[String], maximum: usize, revision: u64) -> Result<(), PlaybackCommandError> {
    if ids.len() > maximum {
        return Err(PlaybackCommandError::invalid(
            revision,
            "The playback context is too large.",
        ));
    }
    for id in ids {
        validate_id(id, revision)?;
    }
    Ok(())
}

fn validate_id(id: &str, revision: u64) -> Result<(), PlaybackCommandError> {
    if !is_valid_id(id) {
        return Err(PlaybackCommandError::invalid(
            revision,
            "Playback identifiers must be opaque, present, and bounded.",
        ));
    }
    Ok(())
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_IDENTIFIER_LENGTH
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn playback_order(length: usize, shuffle: bool, seed: u64) -> Vec<usize> {
    let mut order = (0..length).collect::<Vec<_>>();
    if !shuffle || length < 2 {
        return order;
    }
    let mut state = seed.max(1);
    for index in (1..length).rev() {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        order.swap(index, (state as usize) % (index + 1));
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn request(revision: u64, command: PlaybackCommand) -> PlaybackCommandRequest {
        PlaybackCommandRequest {
            command,
            expected_revision: revision,
        }
    }

    fn replace(track_ids: &[&str], start_index: usize) -> PlaybackCommand {
        PlaybackCommand::ReplaceContext {
            autoplay: true,
            start_index,
            track_ids: track_ids.iter().map(|id| (*id).to_string()).collect(),
        }
    }

    fn queue(entry_id: &str, track_id: &str) -> QueueEntry {
        QueueEntry {
            entry_id: entry_id.to_string(),
            track_id: track_id.to_string(),
        }
    }

    fn current(snapshot: &PlaybackSnapshot) -> Option<&str> {
        snapshot
            .current
            .as_ref()
            .map(|current| current.track_id.as_str())
    }

    fn dispatch_committed(state: &PlaybackState, command: PlaybackCommand) -> PlaybackSnapshot {
        let revision = state.snapshot().expect("snapshot").revision;
        let snapshot = state
            .dispatch(request(revision, command))
            .expect("dispatch command");
        if snapshot.transition_pending {
            state
                .dispatch(request(
                    snapshot.revision,
                    PlaybackCommand::CommitTransition,
                ))
                .expect("commit transition")
        } else {
            snapshot
        }
    }

    #[test]
    fn command_request_deserializes_camel_case_variant_fields() {
        let request: PlaybackCommandRequest = serde_json::from_value(serde_json::json!({
            "command": {
                "type": "replaceContext",
                "autoplay": true,
                "startIndex": 1,
                "trackIds": ["track-one", "track-two"]
            },
            "expectedRevision": 4
        }))
        .expect("camel-case playback command request");

        assert_eq!(request.expected_revision, 4);
        assert!(matches!(
            request.command,
            PlaybackCommand::ReplaceContext {
                autoplay: true,
                start_index: 1,
                track_ids
            } if track_ids == ["track-one", "track-two"]
        ));
    }

    #[test]
    fn revision_conflicts_and_invalid_commands_do_not_mutate_state() {
        let state = PlaybackState::default();
        let first = dispatch_committed(&state, replace(&["one"], 0));
        assert_eq!(first.revision, 2);

        let stale = state
            .dispatch(request(0, PlaybackCommand::Pause))
            .expect_err("stale");
        assert_eq!(stale.code, "stale_revision");
        assert_eq!(state.snapshot().expect("snapshot"), first);

        let invalid = state
            .dispatch(request(
                first.revision,
                PlaybackCommand::SetVolume {
                    muted: false,
                    volume_percent: 101,
                },
            ))
            .expect_err("invalid volume");
        assert_eq!(invalid.code, "invalid_command");
        assert_eq!(state.snapshot().expect("snapshot"), first);
    }

    #[test]
    fn queue_entries_preserve_duplicates_and_take_precedence() {
        let state = PlaybackState::default();
        dispatch_committed(&state, replace(&["one", "two"], 0));
        dispatch_committed(
            &state,
            PlaybackCommand::Enqueue {
                entries: vec![queue("q1", "bonus"), queue("q2", "bonus")],
            },
        );

        let first = dispatch_committed(&state, PlaybackCommand::Next);
        assert_eq!(current(&first), Some("bonus"));
        assert_eq!(
            first
                .current
                .as_ref()
                .and_then(|item| item.queue_entry_id.as_deref()),
            Some("q1")
        );
        assert_eq!(first.queue, vec![queue("q2", "bonus")]);

        let second = dispatch_committed(&state, PlaybackCommand::Ended);
        assert_eq!(
            second
                .current
                .as_ref()
                .and_then(|item| item.queue_entry_id.as_deref()),
            Some("q2")
        );
        assert!(second.queue.is_empty());

        let context = dispatch_committed(&state, PlaybackCommand::Ended);
        assert_eq!(current(&context), Some("two"));
    }

    #[test]
    fn repeat_modes_apply_only_at_ended_boundaries() {
        let state = PlaybackState::default();
        dispatch_committed(&state, replace(&["one", "two"], 1));
        dispatch_committed(
            &state,
            PlaybackCommand::SetRepeat {
                repeat_mode: RepeatMode::One,
            },
        );
        let same = dispatch_committed(&state, PlaybackCommand::Ended);
        assert_eq!(current(&same), Some("two"));

        let stopped = dispatch_committed(&state, PlaybackCommand::Next);
        assert_eq!(current(&stopped), None);
        assert_eq!(stopped.status, PlaybackStatus::Stopped);

        dispatch_committed(&state, replace(&["one", "two"], 1));
        dispatch_committed(
            &state,
            PlaybackCommand::SetRepeat {
                repeat_mode: RepeatMode::All,
            },
        );
        let wrapped = dispatch_committed(&state, PlaybackCommand::Next);
        assert_eq!(current(&wrapped), Some("one"));
    }

    #[test]
    fn shuffle_is_deterministic_and_preserves_the_current_track() {
        let state = PlaybackState::default();
        dispatch_committed(&state, replace(&["a", "b", "c", "d"], 2));
        let shuffled = dispatch_committed(
            &state,
            PlaybackCommand::SetShuffle {
                enabled: true,
                seed: 42,
            },
        );
        assert_eq!(current(&shuffled), Some("c"));
        assert_eq!(shuffled.context.order, playback_order(4, true, 42));
        assert_ne!(shuffled.context.order, vec![0, 1, 2, 3]);

        let other = PlaybackState::default();
        dispatch_committed(&other, replace(&["a", "b", "c", "d"], 2));
        let same = dispatch_committed(
            &other,
            PlaybackCommand::SetShuffle {
                enabled: true,
                seed: 42,
            },
        );
        assert_eq!(shuffled.context.order, same.context.order);
    }

    #[test]
    fn previous_restarts_then_walks_actual_history() {
        let state = PlaybackState::default();
        dispatch_committed(&state, replace(&["one", "two"], 0));
        dispatch_committed(&state, PlaybackCommand::Next);
        dispatch_committed(
            &state,
            PlaybackCommand::UpdateDuration {
                duration_ms: 60_000,
            },
        );
        dispatch_committed(
            &state,
            PlaybackCommand::Seek {
                position_ms: 11_000,
            },
        );

        let restarted = dispatch_committed(&state, PlaybackCommand::Previous);
        assert_eq!(current(&restarted), Some("two"));
        assert_eq!(restarted.position_ms, 0);
        let previous = dispatch_committed(&state, PlaybackCommand::Previous);
        assert_eq!(current(&previous), Some("one"));
    }

    #[test]
    fn previous_and_next_do_not_lose_consumed_queue_entries() {
        let state = PlaybackState::default();
        dispatch_committed(&state, replace(&["one", "two"], 0));
        dispatch_committed(
            &state,
            PlaybackCommand::Enqueue {
                entries: vec![queue("q1", "bonus-one"), queue("q2", "bonus-two")],
            },
        );
        dispatch_committed(&state, PlaybackCommand::Next);
        dispatch_committed(&state, PlaybackCommand::Ended);

        let previous = dispatch_committed(&state, PlaybackCommand::Previous);
        assert_eq!(current(&previous), Some("bonus-one"));
        assert_eq!(previous.queue, vec![queue("q2", "bonus-two")]);

        let replayed = dispatch_committed(&state, PlaybackCommand::Next);
        assert_eq!(current(&replayed), Some("bonus-two"));
        let context = dispatch_committed(&state, PlaybackCommand::Ended);
        assert_eq!(current(&context), Some("two"));
    }

    #[test]
    fn unavailable_current_track_skips_without_exposing_a_path() {
        let state = PlaybackState::default();
        dispatch_committed(&state, replace(&["one", "two"], 0));
        dispatch_committed(
            &state,
            PlaybackCommand::Enqueue {
                entries: vec![queue("q1", "one"), queue("q2", "bonus")],
            },
        );
        let snapshot = dispatch_committed(
            &state,
            PlaybackCommand::MarkUnavailable {
                track_id: "one".to_string(),
            },
        );
        assert_eq!(current(&snapshot), Some("bonus"));
        assert!(snapshot.queue.is_empty());
        assert_eq!(
            snapshot.error.as_ref().map(|error| error.code),
            Some(PlaybackErrorCode::Unavailable)
        );
        assert!(!serde_json::to_string(&snapshot)
            .expect("serialize")
            .contains('/'));

        let next = dispatch_committed(&state, PlaybackCommand::Ended);
        assert_eq!(current(&next), Some("two"));
        assert_eq!(next.context.track_ids, vec!["two"]);
    }

    #[test]
    fn queue_editing_uses_entry_identity_and_is_bounded() {
        let state = PlaybackState::default();
        let queued = state
            .dispatch(request(
                0,
                PlaybackCommand::Enqueue {
                    entries: vec![
                        queue("one", "same"),
                        queue("two", "same"),
                        queue("three", "other"),
                    ],
                },
            ))
            .expect("enqueue");
        let moved = state
            .dispatch(request(
                queued.revision,
                PlaybackCommand::MoveQueueEntry {
                    before_entry_id: Some("one".to_string()),
                    entry_id: "three".to_string(),
                },
            ))
            .expect("move");
        assert_eq!(
            moved.queue,
            vec![
                queue("three", "other"),
                queue("one", "same"),
                queue("two", "same")
            ]
        );
        let removed = state
            .dispatch(request(
                moved.revision,
                PlaybackCommand::RemoveQueueEntry {
                    entry_id: "one".to_string(),
                },
            ))
            .expect("remove");
        assert_eq!(
            removed.queue,
            vec![queue("three", "other"), queue("two", "same")]
        );

        let duplicate = state
            .dispatch(request(
                removed.revision,
                PlaybackCommand::Enqueue {
                    entries: vec![queue("two", "new")],
                },
            ))
            .expect_err("duplicate ID");
        assert_eq!(duplicate.code, "invalid_command");
    }

    #[test]
    fn rejected_transition_restores_queue_context_history_and_current() {
        let state = PlaybackState::default();
        dispatch_committed(&state, replace(&["one", "two"], 0));
        let before = dispatch_committed(
            &state,
            PlaybackCommand::Enqueue {
                entries: vec![queue("q1", "bonus")],
            },
        );

        let prepared = state
            .dispatch(request(before.revision, PlaybackCommand::Next))
            .expect("prepare next");
        assert!(prepared.transition_pending);
        assert_eq!(current(&prepared), Some("bonus"));
        assert!(prepared.queue.is_empty());

        let rejected = state
            .dispatch(request(
                prepared.revision,
                PlaybackCommand::RejectTransition {
                    code: PlaybackErrorCode::Decoder,
                    recoverable: true,
                },
            ))
            .expect("reject transition");
        assert_eq!(rejected.revision, prepared.revision + 1);
        assert!(!rejected.transition_pending);
        assert_eq!(rejected.context, before.context);
        assert_eq!(rejected.current, before.current);
        assert_eq!(rejected.history, before.history);
        assert_eq!(rejected.queue, before.queue);
        assert_eq!(rejected.status, PlaybackStatus::Paused);
        assert_eq!(
            rejected.error,
            Some(PlaybackFailure {
                code: PlaybackErrorCode::Decoder,
                recoverable: true,
            })
        );
    }

    #[test]
    fn committed_transition_keeps_prepared_queue_consumption() {
        let state = PlaybackState::default();
        dispatch_committed(&state, replace(&["one"], 0));
        let queued = dispatch_committed(
            &state,
            PlaybackCommand::Enqueue {
                entries: vec![queue("q1", "bonus")],
            },
        );
        let prepared = state
            .dispatch(request(queued.revision, PlaybackCommand::Next))
            .expect("prepare next");
        let committed = state
            .dispatch(request(
                prepared.revision,
                PlaybackCommand::CommitTransition,
            ))
            .expect("commit transition");

        assert_eq!(committed.revision, prepared.revision + 1);
        assert!(!committed.transition_pending);
        assert_eq!(current(&committed), Some("bonus"));
        assert!(committed.queue.is_empty());
    }

    #[test]
    fn pending_transition_excludes_other_commands_without_mutation() {
        let state = PlaybackState::default();
        let first = state
            .dispatch(request(0, replace(&["one", "two"], 0)))
            .expect("prepare context");
        let error = state
            .dispatch(request(first.revision, PlaybackCommand::Next))
            .expect_err("pending transition");
        assert_eq!(error.code, "transition_pending");
        assert_eq!(state.snapshot().expect("snapshot"), first);
    }

    #[test]
    fn position_observation_updates_in_place_for_the_current_track() {
        let state = PlaybackState::default();
        let current = dispatch_committed(&state, replace(&["one"], 0));
        let observed = state
            .observe_position(PlaybackPositionObservation {
                duration_ms: 60_000,
                expected_revision: current.revision,
                position_ms: 12_500,
                track_id: "one".to_string(),
            })
            .expect("observe position");
        assert_eq!(observed.revision, current.revision + 1);
        assert_eq!(observed.position_ms, 12_500);
        assert_eq!(observed.duration_ms, 60_000);

        let mismatch = state
            .observe_position(PlaybackPositionObservation {
                duration_ms: 60_000,
                expected_revision: observed.revision,
                position_ms: 13_000,
                track_id: "other".to_string(),
            })
            .expect_err("track mismatch");
        assert_eq!(mismatch.code, "invalid_command");
    }

    #[test]
    fn rejected_context_replacement_restores_previous_selection() {
        let state = PlaybackState::default();
        let before = dispatch_committed(&state, replace(&["one", "two"], 1));
        let prepared = state
            .dispatch(request(before.revision, replace(&["other"], 0)))
            .expect("prepare replacement");
        assert_eq!(current(&prepared), Some("other"));
        let rejected = state
            .dispatch(request(
                prepared.revision,
                PlaybackCommand::RejectTransition {
                    code: PlaybackErrorCode::Output,
                    recoverable: false,
                },
            ))
            .expect("reject replacement");
        assert_eq!(current(&rejected), Some("two"));
        assert_eq!(rejected.context, before.context);
    }

    #[test]
    fn identifiers_and_collection_sizes_are_bounded_before_mutation() {
        let state = PlaybackState::default();
        let path_like = state
            .dispatch(request(0, replace(&["/private/music.mp3"], 0)))
            .expect_err("path-like identifier");
        assert_eq!(path_like.code, "invalid_command");

        let oversized_context = (0..=MAX_CONTEXT_TRACKS)
            .map(|index| format!("track-{index}"))
            .collect();
        let context_error = state
            .dispatch(request(
                0,
                PlaybackCommand::ReplaceContext {
                    autoplay: false,
                    start_index: 0,
                    track_ids: oversized_context,
                },
            ))
            .expect_err("oversized context");
        assert_eq!(context_error.code, "invalid_command");

        let oversized_queue = (0..=MAX_QUEUE_ENTRIES)
            .map(|index| queue(&format!("entry-{index}"), &format!("track-{index}")))
            .collect();
        let queue_error = state
            .dispatch(request(
                0,
                PlaybackCommand::Enqueue {
                    entries: oversized_queue,
                },
            ))
            .expect_err("oversized queue");
        assert_eq!(queue_error.code, "invalid_command");
        assert_eq!(
            state.snapshot().expect("snapshot"),
            PlaybackSnapshot::default()
        );
    }

    #[test]
    fn concurrent_commands_cannot_both_commit_the_same_revision() {
        let state = Arc::new(PlaybackState::default());
        let initial = dispatch_committed(&state, replace(&["one"], 0));
        let barrier = Arc::new(Barrier::new(3));
        let handles = (0..2)
            .map(|_| {
                let state = Arc::clone(&state);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    state.dispatch(request(initial.revision, PlaybackCommand::Pause))
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread"))
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .filter(|error| error.code == "stale_revision")
                .count(),
            1
        );
        let snapshot = state.snapshot().expect("snapshot");
        assert_eq!(snapshot.revision, initial.revision + 1);
        assert_eq!(snapshot.status, PlaybackStatus::Paused);
    }

    #[test]
    fn snapshot_serialization_is_versioned_and_camel_case() {
        let state = PlaybackState::default();
        let snapshot = state
            .dispatch(request(0, replace(&["one"], 0)))
            .expect("replace");
        let json = serde_json::to_value(snapshot).expect("serialize snapshot");
        assert_eq!(json["schemaVersion"], SNAPSHOT_VERSION);
        assert_eq!(json["revision"], 1);
        assert_eq!(json["status"], "playing");
        assert_eq!(json["transitionPending"], true);
        assert_eq!(json["current"]["trackId"], "one");
        assert_eq!(json["volumePercent"], 100);
        assert!(json.get("schema_version").is_none());
    }

    #[test]
    fn listening_history_starts_only_after_commit_and_ignores_rejected_transitions() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open playback history fixture");
            crate::database::NATIVE_MIGRATOR
                .run(&pool)
                .await
                .expect("migrate playback history fixture");
            for track_id in ["one", "two"] {
                sqlx::query(
                    "INSERT INTO songs (
                       id, path, file, title, album, artist, genre, bpm, compilation, date,
                       encoder, trackTotal, trackNumber, codec, duration, sampleRate, side,
                       startTime, favorRating, dateAdded, visualsPath
                     ) VALUES (?, ?, ?, ?, 'Album', 'Artist', '', 0, 0, '2026', '', 2, 1,
                               'flac', '0:02:00.000', '44100', 1, 0, 0, '2026-08-27', '')",
                )
                .bind(track_id)
                .bind(format!("/music/{track_id}.flac"))
                .bind(format!("{track_id}.flac"))
                .bind(track_id)
                .execute(&pool)
                .await
                .expect("insert playback history track");
            }
            let state = PlaybackState::new(pool);
            let history = state.history.as_ref().expect("history recorder");

            let prepared = state
                .dispatch_with_history(request(0, replace(&["one"], 0)))
                .expect("prepare first track");
            assert!(prepared.transition_pending);
            assert_eq!(
                history
                    .page(PlayHistoryQuery::default())
                    .await
                    .expect("page prepared history")
                    .total,
                0
            );

            let committed = state
                .dispatch_with_history(request(
                    prepared.revision,
                    PlaybackCommand::CommitTransition,
                ))
                .expect("commit first track");
            assert_eq!(
                history
                    .page(PlayHistoryQuery::default())
                    .await
                    .expect("page committed history")
                    .total,
                1
            );
            let paused = state
                .dispatch_with_history(request(committed.revision, PlaybackCommand::Pause))
                .expect("pause first track");
            let resumed = state
                .dispatch_with_history(request(paused.revision, PlaybackCommand::Play))
                .expect("resume first track");
            assert_eq!(
                history
                    .page(PlayHistoryQuery::default())
                    .await
                    .expect("page resumed history")
                    .total,
                1
            );

            let second = state
                .dispatch_with_history(request(resumed.revision, replace(&["two"], 0)))
                .expect("prepare second track");
            state
                .dispatch_with_history(request(
                    second.revision,
                    PlaybackCommand::RejectTransition {
                        code: PlaybackErrorCode::Decoder,
                        recoverable: true,
                    },
                ))
                .expect("reject second track");
            let page = history
                .page(PlayHistoryQuery::default())
                .await
                .expect("page rejected history");
            assert_eq!(page.total, 1);
            assert!(page.items[0].ended_at.is_some());
            assert_eq!(page.items[0].track_id, "one");
        });
    }

    #[test]
    fn listening_history_storage_failure_never_blocks_playback_commands() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open missing history schema fixture");
            let state = PlaybackState::new(pool);
            let prepared = state
                .dispatch_with_history(request(0, replace(&["one"], 0)))
                .expect("prepare playback without history schema");
            let committed = state
                .dispatch_with_history(request(
                    prepared.revision,
                    PlaybackCommand::CommitTransition,
                ))
                .expect("commit playback without history schema");

            assert_eq!(committed.status, PlaybackStatus::Playing);
            assert_eq!(current(&committed), Some("one"));
            assert_eq!(
                state
                    .history
                    .as_ref()
                    .expect("history recorder")
                    .page(PlayHistoryQuery::default())
                    .await
                    .expect_err("report missing history schema")
                    .code,
                "play_history_unavailable"
            );
        });
    }

    #[test]
    fn position_checkpoints_are_coalesced() {
        let state = PlaybackState::default();
        assert!(state.checkpoint_due());
        assert!(!state.checkpoint_due());
    }

    #[test]
    fn persistence_failure_sets_a_recoverable_warning_without_changing_revision() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open persistence failure fixture");
            let state = PlaybackState::new(pool);
            state.persist(PlaybackSnapshot::default()).await;
            let snapshot = state.snapshot().expect("read warning snapshot");
            assert!(snapshot.persistence_warning);
            assert_eq!(snapshot.revision, 0);
        });
    }

    #[test]
    fn invalid_saved_session_is_discarded_before_future_recovery_writes() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("open invalid session fixture");
            sqlx::raw_sql(crate::database::PLAYBACK_SESSION_SCHEMA)
                .execute(&pool)
                .await
                .expect("create playback session table");
            sqlx::raw_sql(
                "CREATE TABLE songs (
                   id TEXT PRIMARY KEY,
                   availability TEXT NOT NULL
                 );
                 INSERT INTO playback_session (
                   id, schema_version, snapshot_revision, snapshot_json
                 ) VALUES (1, 1, 999, '{}');",
            )
            .execute(&pool)
            .await
            .expect("insert invalid saved session");
            let state = PlaybackState::new(pool.clone());

            state.ensure_restored().await;

            assert!(
                state
                    .snapshot()
                    .expect("read recovered snapshot")
                    .persistence_warning
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM playback_session")
                    .fetch_one(&pool)
                    .await
                    .expect("count saved sessions"),
                0
            );
        });
    }
}

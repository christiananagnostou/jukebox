use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::State;

const SNAPSHOT_VERSION: u32 = 1;
const MAX_CONTEXT_TRACKS: usize = 10_000;
const MAX_QUEUE_ENTRIES: usize = 10_000;
const MAX_HISTORY_ENTRIES: usize = 1_000;
const MAX_IDENTIFIER_LENGTH: usize = 128;
const PREVIOUS_RESTART_THRESHOLD_MS: u64 = 10_000;

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
#[serde(rename_all = "camelCase")]
pub struct PlaybackFailure {
    code: PlaybackErrorCode,
    recoverable: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    entry_id: String,
    track_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSelection {
    context_index: Option<usize>,
    queue_entry_id: Option<String>,
    resume_context_index: Option<usize>,
    track_id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackContext {
    cursor: Option<usize>,
    order: Vec<usize>,
    track_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    context: PlaybackContext,
    current: Option<PlaybackSelection>,
    duration_ms: u64,
    error: Option<PlaybackFailure>,
    history: Vec<PlaybackSelection>,
    muted: bool,
    position_ms: u64,
    queue: Vec<QueueEntry>,
    repeat_mode: RepeatMode,
    revision: u64,
    schema_version: u32,
    shuffle: ShuffleState,
    status: PlaybackStatus,
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
            position_ms: 0,
            queue: Vec::new(),
            repeat_mode: RepeatMode::Off,
            revision: 0,
            schema_version: SNAPSHOT_VERSION,
            shuffle: ShuffleState::default(),
            status: PlaybackStatus::Stopped,
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
#[serde(tag = "type", rename_all = "camelCase")]
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
}

#[derive(Default)]
pub struct PlaybackState {
    snapshot: Mutex<PlaybackSnapshot>,
}

impl PlaybackState {
    fn snapshot(&self) -> Result<PlaybackSnapshot, PlaybackCommandError> {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| PlaybackCommandError::unavailable())
    }

    fn dispatch(
        &self,
        request: PlaybackCommandRequest,
    ) -> Result<PlaybackSnapshot, PlaybackCommandError> {
        let mut snapshot = self
            .snapshot
            .lock()
            .map_err(|_| PlaybackCommandError::unavailable())?;
        if request.expected_revision != snapshot.revision {
            return Err(PlaybackCommandError::stale(snapshot.revision));
        }

        let mut next = snapshot.clone();
        let changed = next.apply(request.command)?;
        if changed {
            next.revision = next.revision.saturating_add(1);
            *snapshot = next;
        }
        Ok(snapshot.clone())
    }
}

#[tauri::command]
pub fn get_playback_snapshot(
    state: State<'_, PlaybackState>,
) -> Result<PlaybackSnapshot, PlaybackCommandError> {
    state.snapshot()
}

#[tauri::command]
pub fn dispatch_playback_command(
    state: State<'_, PlaybackState>,
    request: PlaybackCommandRequest,
) -> Result<PlaybackSnapshot, PlaybackCommandError> {
    state.dispatch(request)
}

impl PlaybackSnapshot {
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
    if id.is_empty()
        || id.len() > MAX_IDENTIFIER_LENGTH
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(PlaybackCommandError::invalid(
            revision,
            "Playback identifiers must be opaque, present, and bounded.",
        ));
    }
    Ok(())
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

    #[test]
    fn revision_conflicts_and_invalid_commands_do_not_mutate_state() {
        let state = PlaybackState::default();
        let first = state
            .dispatch(request(0, replace(&["one"], 0)))
            .expect("replace");
        assert_eq!(first.revision, 1);

        let stale = state
            .dispatch(request(0, PlaybackCommand::Pause))
            .expect_err("stale");
        assert_eq!(stale.code, "stale_revision");
        assert_eq!(state.snapshot().expect("snapshot"), first);

        let invalid = state
            .dispatch(request(
                1,
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
        state
            .dispatch(request(0, replace(&["one", "two"], 0)))
            .expect("replace");
        state
            .dispatch(request(
                1,
                PlaybackCommand::Enqueue {
                    entries: vec![queue("q1", "bonus"), queue("q2", "bonus")],
                },
            ))
            .expect("enqueue");

        let first = state
            .dispatch(request(2, PlaybackCommand::Next))
            .expect("next");
        assert_eq!(current(&first), Some("bonus"));
        assert_eq!(
            first
                .current
                .as_ref()
                .and_then(|item| item.queue_entry_id.as_deref()),
            Some("q1")
        );
        assert_eq!(first.queue, vec![queue("q2", "bonus")]);

        let second = state
            .dispatch(request(3, PlaybackCommand::Ended))
            .expect("ended");
        assert_eq!(
            second
                .current
                .as_ref()
                .and_then(|item| item.queue_entry_id.as_deref()),
            Some("q2")
        );
        assert!(second.queue.is_empty());

        let context = state
            .dispatch(request(4, PlaybackCommand::Ended))
            .expect("ended");
        assert_eq!(current(&context), Some("two"));
    }

    #[test]
    fn repeat_modes_apply_only_at_ended_boundaries() {
        let state = PlaybackState::default();
        state
            .dispatch(request(0, replace(&["one", "two"], 1)))
            .expect("replace");
        state
            .dispatch(request(
                1,
                PlaybackCommand::SetRepeat {
                    repeat_mode: RepeatMode::One,
                },
            ))
            .expect("repeat one");
        let same = state
            .dispatch(request(2, PlaybackCommand::Ended))
            .expect("repeat");
        assert_eq!(current(&same), Some("two"));

        let stopped = state
            .dispatch(request(3, PlaybackCommand::Next))
            .expect("manual next");
        assert_eq!(current(&stopped), None);
        assert_eq!(stopped.status, PlaybackStatus::Stopped);

        state
            .dispatch(request(4, replace(&["one", "two"], 1)))
            .expect("replace");
        state
            .dispatch(request(
                5,
                PlaybackCommand::SetRepeat {
                    repeat_mode: RepeatMode::All,
                },
            ))
            .expect("repeat all");
        let wrapped = state
            .dispatch(request(6, PlaybackCommand::Next))
            .expect("wrap");
        assert_eq!(current(&wrapped), Some("one"));
    }

    #[test]
    fn shuffle_is_deterministic_and_preserves_the_current_track() {
        let state = PlaybackState::default();
        state
            .dispatch(request(0, replace(&["a", "b", "c", "d"], 2)))
            .expect("replace");
        let shuffled = state
            .dispatch(request(
                1,
                PlaybackCommand::SetShuffle {
                    enabled: true,
                    seed: 42,
                },
            ))
            .expect("shuffle");
        assert_eq!(current(&shuffled), Some("c"));
        assert_eq!(shuffled.context.order, playback_order(4, true, 42));
        assert_ne!(shuffled.context.order, vec![0, 1, 2, 3]);

        let other = PlaybackState::default();
        other
            .dispatch(request(0, replace(&["a", "b", "c", "d"], 2)))
            .expect("replace");
        let same = other
            .dispatch(request(
                1,
                PlaybackCommand::SetShuffle {
                    enabled: true,
                    seed: 42,
                },
            ))
            .expect("shuffle");
        assert_eq!(shuffled.context.order, same.context.order);
    }

    #[test]
    fn previous_restarts_then_walks_actual_history() {
        let state = PlaybackState::default();
        state
            .dispatch(request(0, replace(&["one", "two"], 0)))
            .expect("replace");
        state
            .dispatch(request(1, PlaybackCommand::Next))
            .expect("next");
        state
            .dispatch(request(
                2,
                PlaybackCommand::UpdateDuration {
                    duration_ms: 60_000,
                },
            ))
            .expect("duration");
        state
            .dispatch(request(
                3,
                PlaybackCommand::Seek {
                    position_ms: 11_000,
                },
            ))
            .expect("seek");

        let restarted = state
            .dispatch(request(4, PlaybackCommand::Previous))
            .expect("restart");
        assert_eq!(current(&restarted), Some("two"));
        assert_eq!(restarted.position_ms, 0);
        let previous = state
            .dispatch(request(5, PlaybackCommand::Previous))
            .expect("previous");
        assert_eq!(current(&previous), Some("one"));
    }

    #[test]
    fn previous_and_next_do_not_lose_consumed_queue_entries() {
        let state = PlaybackState::default();
        state
            .dispatch(request(0, replace(&["one", "two"], 0)))
            .expect("replace");
        state
            .dispatch(request(
                1,
                PlaybackCommand::Enqueue {
                    entries: vec![queue("q1", "bonus-one"), queue("q2", "bonus-two")],
                },
            ))
            .expect("enqueue");
        state
            .dispatch(request(2, PlaybackCommand::Next))
            .expect("first queue entry");
        state
            .dispatch(request(3, PlaybackCommand::Ended))
            .expect("second queue entry");

        let previous = state
            .dispatch(request(4, PlaybackCommand::Previous))
            .expect("previous queue entry");
        assert_eq!(current(&previous), Some("bonus-one"));
        assert_eq!(previous.queue, vec![queue("q2", "bonus-two")]);

        let replayed = state
            .dispatch(request(5, PlaybackCommand::Next))
            .expect("replay second queue entry");
        assert_eq!(current(&replayed), Some("bonus-two"));
        let context = state
            .dispatch(request(6, PlaybackCommand::Ended))
            .expect("resume context");
        assert_eq!(current(&context), Some("two"));
    }

    #[test]
    fn unavailable_current_track_skips_without_exposing_a_path() {
        let state = PlaybackState::default();
        state
            .dispatch(request(0, replace(&["one", "two"], 0)))
            .expect("replace");
        state
            .dispatch(request(
                1,
                PlaybackCommand::Enqueue {
                    entries: vec![queue("q1", "one"), queue("q2", "bonus")],
                },
            ))
            .expect("enqueue");
        let snapshot = state
            .dispatch(request(
                2,
                PlaybackCommand::MarkUnavailable {
                    track_id: "one".to_string(),
                },
            ))
            .expect("unavailable");
        assert_eq!(current(&snapshot), Some("bonus"));
        assert!(snapshot.queue.is_empty());
        assert_eq!(
            snapshot.error.as_ref().map(|error| error.code),
            Some(PlaybackErrorCode::Unavailable)
        );
        assert!(!serde_json::to_string(&snapshot)
            .expect("serialize")
            .contains('/'));

        let next = state
            .dispatch(request(snapshot.revision, PlaybackCommand::Ended))
            .expect("continue context");
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
        state
            .dispatch(request(0, replace(&["one"], 0)))
            .expect("replace");
        let barrier = Arc::new(Barrier::new(3));
        let handles = (0..2)
            .map(|_| {
                let state = Arc::clone(&state);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    state.dispatch(request(1, PlaybackCommand::Pause))
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
        assert_eq!(snapshot.revision, 2);
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
        assert_eq!(json["current"]["trackId"], "one");
        assert_eq!(json["volumePercent"], 100);
        assert!(json.get("schema_version").is_none());
    }
}

import type { PlaybackSource, PlaybackViewState, QueuedSong, Song } from '~/App'
import type { PlaybackSelection, PlaybackSnapshot } from '~/services/playback-client'

export const PLAYBACK_ERROR_MESSAGE = 'This track could not be played'
export const PLAYBACK_ACCESS_ERROR_MESSAGE = 'Music folder access is required. Reconnect the folder in Settings.'
export const PLAYBACK_PERSISTENCE_WARNING_MESSAGE = 'Playback progress may not be saved'
export const DEFAULT_VOLUME_PERCENT = 100

export interface PlaybackMetadataProjection {
  context: Song[]
  current?: Song
  queue: QueuedSong[]
  source?: PlaybackSource
}

export function createPlaybackViewState(): PlaybackViewState {
  return {
    canUndoQueueEdit: false,
    context: [],
    current: undefined,
    currentContextIndex: null,
    currentTime: 0,
    duration: 0,
    error: '',
    isPaused: true,
    muted: false,
    queue: [],
    repeatMode: 'off',
    shuffleEnabled: false,
    shuffleSeed: 1,
    source: undefined,
    volumePercent: DEFAULT_VOLUME_PERCENT,
  }
}

function selectionContextIndex(selection?: PlaybackSelection | null): number | null {
  if (!selection) return null
  return selection.contextIndex ?? selection.resumeContextIndex ?? null
}

function playbackMessage(snapshot: PlaybackSnapshot): string {
  if (snapshot.error) return PLAYBACK_ERROR_MESSAGE
  return snapshot.persistenceWarning ? PLAYBACK_PERSISTENCE_WARNING_MESSAGE : ''
}

export function projectPlaybackView(
  snapshot: PlaybackSnapshot,
  metadata: PlaybackMetadataProjection
): PlaybackViewState {
  return {
    canUndoQueueEdit: snapshot.canUndoQueueEdit,
    context: metadata.context,
    current: metadata.current,
    currentContextIndex: selectionContextIndex(snapshot.current),
    currentTime: snapshot.positionMs / 1000,
    duration: snapshot.durationMs / 1000,
    error: playbackMessage(snapshot),
    isPaused: snapshot.status !== 'playing',
    muted: snapshot.muted,
    queue: metadata.queue,
    repeatMode: snapshot.repeatMode,
    shuffleEnabled: snapshot.shuffle.enabled,
    shuffleSeed: snapshot.shuffle.seed,
    source: metadata.source,
    volumePercent: snapshot.volumePercent,
  }
}

export function commitPlaybackView(target: PlaybackViewState, next: PlaybackViewState): void {
  Object.assign(target, next)
}

export function playbackTrackOccurrences(playback: PlaybackViewState, trackId: string): Song[] {
  const occurrences = [playback.current, ...playback.context, ...playback.queue.map((entry) => entry.song)]
  return [...new Set(occurrences.filter((song): song is Song => song?.id === trackId))]
}

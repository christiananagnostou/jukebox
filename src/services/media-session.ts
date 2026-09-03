import type { Song } from '~/App'

export interface PlaybackMediaActions {
  next(): Promise<void>
  pause(): Promise<void>
  play(): Promise<void>
  previous(): Promise<void>
}

export interface PlaybackMediaSession {
  metadata: MediaMetadata | null
  playbackState: MediaSessionPlaybackState
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void
}

const MEDIA_ACTIONS: ReadonlyArray<{
  action: MediaSessionAction
  run: keyof PlaybackMediaActions
}> = [
  { action: 'play', run: 'play' },
  { action: 'pause', run: 'pause' },
  { action: 'previoustrack', run: 'previous' },
  { action: 'nexttrack', run: 'next' },
]

export function bindPlaybackMediaActions(
  mediaSession: PlaybackMediaSession,
  actions: PlaybackMediaActions
): () => void {
  const installed: MediaSessionAction[] = []

  for (const binding of MEDIA_ACTIONS) {
    try {
      mediaSession.setActionHandler(binding.action, () => {
        void actions[binding.run]().catch(() => undefined)
      })
      installed.push(binding.action)
    } catch {
      // Older WebKit versions may expose Media Session without every action.
    }
  }

  return () => {
    for (const action of installed) {
      try {
        mediaSession.setActionHandler(action, null)
      } catch {
        // A disappearing system media session needs no recovery during cleanup.
      }
    }
  }
}

export function syncPlaybackMediaSession(
  mediaSession: PlaybackMediaSession,
  current: Song | undefined,
  isPaused: boolean,
  createMetadata?: (metadata: MediaMetadataInit) => MediaMetadata
): void {
  try {
    mediaSession.playbackState = current ? (isPaused ? 'paused' : 'playing') : 'none'
  } catch {
    // Metadata and playback state are enhancements; audio remains authoritative.
  }

  if (!current || !createMetadata) {
    if (!current) {
      try {
        mediaSession.metadata = null
      } catch {
        // Ignore WebKit implementations that expose a read-only metadata slot.
      }
    }
    return
  }

  try {
    mediaSession.metadata = createMetadata({
      album: current.album,
      artist: current.artist,
      title: current.title || current.file,
    })
  } catch {
    // Metadata failure must not interfere with playback controls.
  }
}

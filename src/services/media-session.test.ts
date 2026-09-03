import { describe, expect, it, vi } from 'vitest'

import type { Song } from '~/App'
import { bindPlaybackMediaActions, syncPlaybackMediaSession, type PlaybackMediaSession } from './media-session'

function mediaSession() {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>()
  const session = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: vi.fn((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      handlers.set(action, handler)
    }),
  } as PlaybackMediaSession
  return { handlers, session }
}

describe('desktop media session', () => {
  it('routes every system transport action through the shared playback controller', async () => {
    const { handlers, session } = mediaSession()
    const actions = {
      next: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      play: vi.fn(async () => undefined),
      previous: vi.fn(async () => undefined),
    }
    const cleanup = bindPlaybackMediaActions(session, actions)

    handlers.get('play')?.({ action: 'play' })
    handlers.get('pause')?.({ action: 'pause' })
    handlers.get('previoustrack')?.({ action: 'previoustrack' })
    handlers.get('nexttrack')?.({ action: 'nexttrack' })
    await Promise.resolve()

    expect(actions.play).toHaveBeenCalledOnce()
    expect(actions.pause).toHaveBeenCalledOnce()
    expect(actions.previous).toHaveBeenCalledOnce()
    expect(actions.next).toHaveBeenCalledOnce()

    cleanup()
    expect([...handlers.values()].every((handler) => handler === null)).toBe(true)
  })

  it('publishes current metadata and playback state without owning playback', () => {
    const { session } = mediaSession()
    const song = {
      album: 'Supernatural',
      artist: 'Santana Feat. Rob Thomas',
      file: 'smooth.flac',
      title: 'Smooth',
    } as Song
    const metadata = { album: song.album, artist: song.artist, title: song.title } as MediaMetadata

    syncPlaybackMediaSession(session, song, false, (value) => {
      expect(value).toEqual(metadata)
      return metadata
    })

    expect(session.playbackState).toBe('playing')
    expect(session.metadata).toBe(metadata)

    syncPlaybackMediaSession(session, undefined, true)
    expect(session.playbackState).toBe('none')
    expect(session.metadata).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import type { Song, Store } from '~/App'
import type { AudioTransport, AudioTransportEvent } from '~/services/audio-transport'
import {
  bindPlaybackEvents,
  createPlaybackController,
  PLAYBACK_ERROR_MESSAGE,
  type PlaybackController,
} from './useAudioPlayer'

const song = (id: string): Song => ({
  id,
  path: `/music/${id}.flac`,
  file: `${id}.flac`,
  title: id,
  album: 'Album',
  artist: 'Artist',
  genre: '',
  bpm: 0,
  compilation: 0,
  date: '',
  encoder: '',
  trackTotal: 1,
  trackNumber: 1,
  codec: 'flac',
  duration: '0:03:00.000',
  sampleRate: '44100',
  side: 1,
  startTime: 0,
  favorRating: 0,
  dateAdded: '2026-08-26T00:00:00.000Z',
  visualsPath: '',
})

class FakeAudioTransport implements AudioTransport {
  currentTime = 0
  duration = 0
  loadedSongId?: string
  loadedSources: Array<{ songId: string; source: string }> = []
  pauseCalls = 0
  playCalls = 0
  private readonly listeners = new Map<AudioTransportEvent, Set<() => void>>()
  private readonly playResults: Array<Promise<void>> = []

  clear(): void {
    this.loadedSongId = undefined
  }

  load(source: string, songId: string): void {
    this.loadedSongId = songId
    this.loadedSources.push({ songId, source })
  }

  pause(): void {
    this.pauseCalls += 1
  }

  play(): Promise<void> {
    this.playCalls += 1
    return this.playResults.shift() || Promise.resolve()
  }

  subscribe(event: AudioTransportEvent, listener: () => void): () => void {
    const listeners = this.listeners.get(event) || new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return () => listeners.delete(listener)
  }

  emit(event: AudioTransportEvent): void {
    for (const listener of this.listeners.get(event) || []) listener()
  }

  listenerCount(event: AudioTransportEvent): number {
    return this.listeners.get(event)?.size || 0
  }

  queuePlay(result: Promise<void>): void {
    this.playResults.push(result)
  }
}

function playbackStore(overrides: Partial<Pick<Store, 'playlist' | 'queue'>> = {}): Pick<Store, 'player' | 'playlist' | 'queue'> {
  return {
    playlist: [],
    queue: [],
    player: {
      currSong: undefined,
      currSongIndex: 0,
      audioElem: undefined,
      error: '',
      isPaused: true,
      currentTime: 0,
      duration: 0,
    },
    ...overrides,
  }
}

function setup(store = playbackStore()): {
  controller: PlaybackController
  store: Pick<Store, 'player' | 'playlist' | 'queue'>
  transport: FakeAudioTransport
} {
  const transport = new FakeAudioTransport()
  const controller = createPlaybackController(store, transport, (path) => `asset:${path}`)
  return { controller, store, transport }
}

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('playback controller', () => {
  it('consumes exactly one queue head after playback succeeds', async () => {
    const first = song('duplicate')
    const second = song('duplicate')
    const { controller, store, transport } = setup(playbackStore({ queue: [first, second] }))

    await controller.nextSong()

    expect(transport.loadedSources).toEqual([{ songId: 'duplicate', source: 'asset:/music/duplicate.flac' }])
    expect(store.queue).toEqual([second])
    expect(store.player.currSong).toBe(first)
    expect(store.player.error).toBe('')
    expect(store.player.isPaused).toBe(false)
  })

  it('preserves the failed queue head and previous current song', async () => {
    const current = song('current')
    const queued = song('queued')
    const store = playbackStore({ queue: [queued] })
    store.player.currSong = current
    store.player.currSongIndex = 3
    const { controller, transport } = setup(store)
    transport.queuePlay(Promise.reject(new Error('raw path-bearing browser error')))

    await expect(controller.nextSong()).rejects.toThrow(PLAYBACK_ERROR_MESSAGE)

    expect(store.queue).toEqual([queued])
    expect(store.player.currSong).toBe(current)
    expect(store.player.currSongIndex).toBe(3)
    expect(store.player.error).toBe(PLAYBACK_ERROR_MESSAGE)
    expect(store.player.isPaused).toBe(true)
  })

  it('clears a previous generic error after a later play succeeds', async () => {
    const next = song('next')
    const store = playbackStore({ playlist: [next] })
    store.player.error = PLAYBACK_ERROR_MESSAGE
    const { controller } = setup(store)

    await controller.nextSong()

    expect(store.player.error).toBe('')
  })

  it('restarts the current transport after ten seconds without loading a track', async () => {
    const store = playbackStore({ playlist: [song('one'), song('two')] })
    store.player.currSongIndex = 1
    store.player.currentTime = 10.1
    const { controller, transport } = setup(store)
    transport.currentTime = 10.1

    await controller.prevSong()

    expect(transport.currentTime).toBe(0)
    expect(store.player.currentTime).toBe(0)
    expect(transport.playCalls).toBe(0)
  })
})

describe('playback event bindings', () => {
  it('catches ended-transition rejection and leaves media state consistent', async () => {
    const queued = song('unplayable')
    const { controller, store, transport } = setup(playbackStore({ queue: [queued] }))
    transport.queuePlay(Promise.reject(new Error('decoder failure')))
    const cleanup = bindPlaybackEvents(store, transport, controller)

    transport.emit('ended')
    await flushPromises()

    expect(store.queue).toEqual([queued])
    expect(store.player.error).toBe(PLAYBACK_ERROR_MESSAGE)
    expect(store.player.isPaused).toBe(true)
    cleanup()
  })

  it('does not double-consume a queue head on rapid ended events', async () => {
    const first = song('first')
    const second = song('second')
    const { controller, store, transport } = setup(playbackStore({ queue: [first, second] }))
    let resolvePlay: () => void = () => {}
    transport.queuePlay(
      new Promise<void>((resolve) => {
        resolvePlay = resolve
      })
    )
    const cleanup = bindPlaybackEvents(store, transport, controller)

    transport.emit('ended')
    transport.emit('ended')
    expect(transport.playCalls).toBe(1)
    resolvePlay()
    await flushPromises()

    expect(store.queue).toEqual([second])
    cleanup()
  })

  it('records media errors and removes the exact listeners during cleanup', () => {
    const { controller, store, transport } = setup()
    const cleanup = bindPlaybackEvents(store, transport, controller)
    expect(transport.listenerCount('ended')).toBe(1)
    expect(transport.listenerCount('error')).toBe(1)

    transport.emit('error')
    expect(store.player.error).toBe(PLAYBACK_ERROR_MESSAGE)
    expect(store.player.isPaused).toBe(true)

    cleanup()
    expect(transport.listenerCount('ended')).toBe(0)
    expect(transport.listenerCount('error')).toBe(0)
    transport.emit('ended')
    expect(transport.playCalls).toBe(0)
  })
})

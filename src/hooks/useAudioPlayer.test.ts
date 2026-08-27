import { describe, expect, it } from 'vitest'

import type { Song, Store } from '~/App'
import type { AudioTransport, AudioTransportEvent } from '~/services/audio-transport'
import type {
  PlaybackBridge,
  PlaybackCommand,
  PlaybackPositionState,
  PlaybackSnapshot,
} from '~/services/playback-client'
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

function emptySnapshot(): PlaybackSnapshot {
  return {
    context: { cursor: null, order: [], trackIds: [] },
    current: null,
    durationMs: 0,
    error: null,
    history: [],
    muted: false,
    positionMs: 0,
    queue: [],
    repeatMode: 'off',
    revision: 0,
    schemaVersion: 1,
    shuffle: { enabled: false, seed: 1 },
    status: 'stopped',
    transitionPending: false,
    volumePercent: 100,
  }
}

const cloneSnapshot = (snapshot: PlaybackSnapshot): PlaybackSnapshot => structuredClone(snapshot)

class FakePlaybackBridge implements PlaybackBridge {
  commands: PlaybackCommand[] = []
  observations: Array<{ durationMs: number; positionMs: number; trackId: string }> = []
  private rollback?: PlaybackSnapshot
  private snapshot = emptySnapshot()

  async getSnapshot(): Promise<PlaybackSnapshot> {
    return cloneSnapshot(this.snapshot)
  }

  async dispatch(command: PlaybackCommand): Promise<PlaybackSnapshot> {
    this.commands.push(command)
    if (this.rollback && command.type !== 'commitTransition' && command.type !== 'rejectTransition') {
      throw { code: 'transition_pending' }
    }

    if (command.type === 'commitTransition') {
      if (!this.rollback) throw { code: 'no_pending_transition' }
      this.rollback = undefined
      this.snapshot.transitionPending = false
      this.snapshot.revision += 1
      return cloneSnapshot(this.snapshot)
    }
    if (command.type === 'rejectTransition') {
      if (!this.rollback) throw { code: 'no_pending_transition' }
      const revision = this.snapshot.revision + 1
      this.snapshot = this.rollback
      this.rollback = undefined
      this.snapshot.error = { code: command.code, recoverable: command.recoverable }
      this.snapshot.revision = revision
      this.snapshot.status = 'paused'
      this.snapshot.transitionPending = false
      return cloneSnapshot(this.snapshot)
    }

    const before = cloneSnapshot(this.snapshot)
    let changed = true
    switch (command.type) {
      case 'replaceContext': {
        this.snapshot.context = {
          cursor: command.trackIds.length ? command.startIndex : null,
          order: command.trackIds.map((_, index) => index),
          trackIds: [...command.trackIds],
        }
        this.snapshot.current = command.trackIds[command.startIndex]
          ? {
              contextIndex: command.startIndex,
              queueEntryId: null,
              resumeContextIndex: null,
              trackId: command.trackIds[command.startIndex],
            }
          : null
        this.snapshot.history = []
        this.snapshot.positionMs = 0
        this.snapshot.durationMs = 0
        this.snapshot.error = null
        this.snapshot.status = this.snapshot.current ? (command.autoplay ? 'playing' : 'paused') : 'stopped'
        break
      }
      case 'enqueue':
        this.snapshot.queue.push(...command.entries)
        break
      case 'clearUpcoming':
        changed = this.snapshot.queue.length > 0
        this.snapshot.queue = []
        break
      case 'next':
      case 'ended': {
        if (this.snapshot.current) this.snapshot.history.push(this.snapshot.current)
        const queued = this.snapshot.queue.shift()
        if (queued) {
          this.snapshot.current = {
            contextIndex: null,
            queueEntryId: queued.entryId,
            resumeContextIndex: this.snapshot.context.cursor,
            trackId: queued.trackId,
          }
        } else {
          const cursor = this.snapshot.context.cursor
          const next = cursor === null || cursor === undefined ? 0 : cursor + 1
          const trackId = this.snapshot.context.trackIds[next]
          this.snapshot.context.cursor = trackId ? next : null
          this.snapshot.current = trackId
            ? { contextIndex: next, queueEntryId: null, resumeContextIndex: null, trackId }
            : null
        }
        this.snapshot.positionMs = 0
        this.snapshot.durationMs = 0
        this.snapshot.status = this.snapshot.current ? 'playing' : 'stopped'
        break
      }
      case 'previous':
        if (this.snapshot.positionMs > 10_000) {
          this.snapshot.positionMs = 0
        } else {
          const previous = this.snapshot.history.pop()
          changed = Boolean(previous)
          if (previous) this.snapshot.current = previous
        }
        break
      case 'play':
        changed = this.snapshot.status !== 'playing'
        if (this.snapshot.current) this.snapshot.status = 'playing'
        break
      case 'pause':
        changed = this.snapshot.status === 'playing'
        this.snapshot.status = 'paused'
        break
      case 'reportError':
        this.snapshot.error = { code: command.code, recoverable: command.recoverable }
        this.snapshot.status = 'paused'
        break
      case 'clearError':
        changed = Boolean(this.snapshot.error)
        this.snapshot.error = null
        break
      case 'seek':
        this.snapshot.positionMs = command.positionMs
        break
      case 'updateDuration':
        this.snapshot.durationMs = command.durationMs
        break
      case 'removeQueueEntry':
        this.snapshot.queue = this.snapshot.queue.filter((entry) => entry.entryId !== command.entryId)
        break
      case 'moveQueueEntry':
      case 'setRepeat':
      case 'setShuffle':
      case 'markUnavailable':
      case 'setVolume':
        break
    }

    if (changed) this.snapshot.revision += 1
    const selectionChanged = JSON.stringify(before.current) !== JSON.stringify(this.snapshot.current)
    const needsConfirmation =
      (command.type === 'replaceContext' && command.autoplay) ||
      command.type === 'next' ||
      command.type === 'previous' ||
      command.type === 'ended' ||
      command.type === 'markUnavailable'
    if (changed && needsConfirmation && selectionChanged && this.snapshot.current) {
      this.rollback = before
      this.snapshot.transitionPending = true
    }
    return cloneSnapshot(this.snapshot)
  }

  async observePosition(trackId: string, positionMs: number, durationMs: number): Promise<PlaybackPositionState> {
    this.observations.push({ durationMs, positionMs, trackId })
    this.snapshot.positionMs = Math.min(positionMs, durationMs)
    this.snapshot.durationMs = durationMs
    this.snapshot.revision += 1
    return { durationMs, positionMs: this.snapshot.positionMs, revision: this.snapshot.revision }
  }
}

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

function playbackStore(playlist: Song[] = []): Pick<Store, 'player' | 'playlist' | 'queue'> {
  return {
    playlist,
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
  }
}

function setup(store = playbackStore()): {
  bridge: FakePlaybackBridge
  controller: PlaybackController
  store: Pick<Store, 'player' | 'playlist' | 'queue'>
  transport: FakeAudioTransport
} {
  const bridge = new FakePlaybackBridge()
  const transport = new FakeAudioTransport()
  let nextQueueId = 0
  const controller = createPlaybackController(
    store,
    transport,
    (path) => `asset:${path}`,
    bridge,
    () => {
      nextQueueId += 1
      return `entry-${nextQueueId}`
    }
  )
  return { bridge, controller, store, transport }
}

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('native-backed playback controller', () => {
  it('commits exactly one duplicate queue entry after playback succeeds', async () => {
    const first = song('duplicate')
    const second = song('duplicate')
    const { bridge, controller, store, transport } = setup()
    await controller.initialize()
    await controller.enqueueSong(first)
    await controller.enqueueSong(second)

    await controller.nextSong()

    expect(transport.loadedSources).toEqual([{ songId: 'duplicate', source: 'asset:/music/duplicate.flac' }])
    expect(store.queue).toEqual([second])
    expect(store.player.currSong).toBe(first)
    expect(bridge.commands.at(-1)).toEqual({ type: 'commitTransition' })
  })

  it('rolls back a failed queue transition and restores the previous current song', async () => {
    const current = song('current')
    const queued = song('queued')
    const { bridge, controller, store, transport } = setup(playbackStore([current]))
    await controller.initialize()
    await controller.playSong(current, 0)
    await controller.enqueueSong(queued)
    transport.queuePlay(Promise.reject(new Error('path-bearing browser error')))

    await expect(controller.nextSong()).rejects.toThrow(PLAYBACK_ERROR_MESSAGE)

    expect(store.queue).toEqual([queued])
    expect(store.player.currSong).toBe(current)
    expect(store.player.error).toBe(PLAYBACK_ERROR_MESSAGE)
    expect(store.player.isPaused).toBe(true)
    expect(bridge.commands.at(-1)).toEqual({ type: 'rejectTransition', code: 'decoder', recoverable: true })
    expect(transport.loadedSongId).toBe('current')
  })

  it('starts the first playlist track when next is pressed before playback begins', async () => {
    const first = song('first')
    const { controller, store } = setup(playbackStore([first]))
    await controller.initialize()

    await controller.nextSong()

    expect(store.player.currSong).toBe(first)
    expect(store.player.isPaused).toBe(false)
  })

  it('restarts the current transport after ten seconds without loading another track', async () => {
    const tracks = [song('one'), song('two')]
    const { controller, store, transport } = setup(playbackStore(tracks))
    await controller.initialize()
    await controller.playSong(tracks[1], 1)
    transport.duration = 60
    await controller.seekSong(10.1)
    const loadCount = transport.loadedSources.length

    await controller.prevSong()

    expect(transport.currentTime).toBe(0)
    expect(store.player.currentTime).toBe(0)
    expect(transport.loadedSources).toHaveLength(loadCount)
  })
})

describe('playback event bindings', () => {
  it('catches ended-transition rejection without losing the queue head', async () => {
    const current = song('current')
    const queued = song('unplayable')
    const { controller, store, transport } = setup(playbackStore([current]))
    await controller.initialize()
    await controller.playSong(current, 0)
    await controller.enqueueSong(queued)
    transport.queuePlay(Promise.reject(new Error('decoder failure')))
    const cleanup = bindPlaybackEvents(store, transport, controller)

    transport.emit('ended')
    await flushPromises()

    expect(store.queue).toEqual([queued])
    expect(store.player.error).toBe(PLAYBACK_ERROR_MESSAGE)
    cleanup()
  })

  it('does not double-consume a queue head on rapid ended events', async () => {
    const current = song('current')
    const first = song('first')
    const second = song('second')
    const { controller, store, transport } = setup(playbackStore([current]))
    await controller.initialize()
    await controller.playSong(current, 0)
    await controller.enqueueSong(first)
    await controller.enqueueSong(second)
    let resolvePlay: () => void = () => {}
    transport.queuePlay(new Promise<void>((resolve) => (resolvePlay = resolve)))
    const cleanup = bindPlaybackEvents(store, transport, controller)

    transport.emit('ended')
    transport.emit('ended')
    await Promise.resolve()
    await Promise.resolve()
    expect(transport.playCalls).toBe(2)
    resolvePlay()
    await flushPromises()

    expect(store.queue).toEqual([second])
    cleanup()
  })

  it('throttles position observations and removes exact listeners during cleanup', async () => {
    const current = song('current')
    const { bridge, controller, store, transport } = setup(playbackStore([current]))
    await controller.initialize()
    await controller.playSong(current, 0)
    transport.duration = 60
    const cleanup = bindPlaybackEvents(store, transport, controller)

    transport.currentTime = 1
    transport.emit('timeupdate')
    transport.currentTime = 2
    transport.emit('timeupdate')
    await flushPromises()
    expect(bridge.observations).toHaveLength(1)
    expect(transport.listenerCount('ended')).toBe(1)
    expect(transport.listenerCount('error')).toBe(1)

    cleanup()
    expect(transport.listenerCount('ended')).toBe(0)
    expect(transport.listenerCount('error')).toBe(0)
  })
})

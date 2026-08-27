import { $, noSerialize, useSignal, useVisibleTask$, type NoSerialize } from '@builder.io/qwik'
import { convertFileSrc } from '@tauri-apps/api/core'

import type { Song, Store } from '~/App'
import { BrowserAudioTransport, type AudioTransport } from '~/services/audio-transport'
import {
  NativePlaybackBridge,
  type PlaybackBridge,
  type PlaybackCommand,
  type PlaybackSelection,
  type PlaybackSnapshot,
} from '~/services/playback-client'

export const PLAYBACK_ERROR_MESSAGE = 'This track could not be played'

const POSITION_OBSERVATION_INTERVAL_MS = 250
let queueSequence = 0

type PlaybackStore = Pick<Store, 'player' | 'playlist' | 'queue'>
type QueueIdFactory = () => string
type SourceResolver = (path: string) => string

export interface PlaybackController {
  clearPlayback(): Promise<void>
  enqueueSong(song: Song): Promise<void>
  handleEnded(): Promise<void>
  handleMediaError(): Promise<void>
  initialize(): Promise<void>
  nextSong(): Promise<void>
  observePosition(): Promise<void>
  pauseSong(): Promise<void>
  playSong(song: Song, index: number): Promise<void>
  prevSong(): Promise<void>
  resumeSong(): Promise<void>
  seekSong(positionSeconds: number): Promise<void>
}

function defaultQueueId(): string {
  queueSequence += 1
  return `queue-${Date.now().toString(36)}-${queueSequence.toString(36)}`
}

function milliseconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0
}

function recordPlaybackFailure(store: PlaybackStore): void {
  store.player.error = PLAYBACK_ERROR_MESSAGE
  store.player.isPaused = true
}

export function createPlaybackController(
  store: PlaybackStore,
  transport: AudioTransport,
  resolveSource: SourceResolver,
  bridge: PlaybackBridge,
  createQueueId: QueueIdFactory = defaultQueueId
): PlaybackController {
  const queuedSongs = new Map<string, Song>()
  let transitionTask: Promise<void> | undefined

  const loadSong = (song: Song) => {
    transport.load(resolveSource(song.path), song.id)
  }

  const songForSelection = (selection?: PlaybackSelection | null): Song | undefined => {
    if (!selection) return undefined
    if (selection.queueEntryId) {
      const queued = queuedSongs.get(selection.queueEntryId)
      if (queued) return queued
    }
    if (selection.contextIndex !== null && selection.contextIndex !== undefined) {
      const contextual = store.playlist[selection.contextIndex]
      if (contextual?.id === selection.trackId) return contextual
    }
    if (store.player.currSong?.id === selection.trackId) return store.player.currSong
    return (
      store.playlist.find((song) => song.id === selection.trackId) ||
      [...queuedSongs.values()].find((song) => song.id === selection.trackId)
    )
  }

  const mirrorSnapshot = (snapshot: PlaybackSnapshot): void => {
    const currentSong = songForSelection(snapshot.current)
    store.player.currSong = currentSong
    if (snapshot.current?.contextIndex !== null && snapshot.current?.contextIndex !== undefined) {
      store.player.currSongIndex = snapshot.current.contextIndex
    } else if (snapshot.current?.resumeContextIndex !== null && snapshot.current?.resumeContextIndex !== undefined) {
      store.player.currSongIndex = snapshot.current.resumeContextIndex
    }
    store.player.currentTime = snapshot.positionMs / 1000
    store.player.duration = snapshot.durationMs / 1000
    store.player.error = snapshot.error ? PLAYBACK_ERROR_MESSAGE : ''
    store.player.isPaused = snapshot.status !== 'playing'
    store.queue = snapshot.queue.flatMap((entry) => {
      const song = queuedSongs.get(entry.entryId)
      return song ? [song] : []
    })

    const retainedEntryIds = new Set(
      [snapshot.current, ...snapshot.history]
        .map((selection) => selection?.queueEntryId)
        .filter((entryId): entryId is string => Boolean(entryId))
    )
    for (const entry of snapshot.queue) retainedEntryIds.add(entry.entryId)
    for (const entryId of queuedSongs.keys()) {
      if (!retainedEntryIds.has(entryId)) queuedSongs.delete(entryId)
    }
  }

  const rejectPreparedTransition = async (snapshot: PlaybackSnapshot, code: 'decoder' | 'unavailable') => {
    if (!snapshot.transitionPending) return snapshot
    const rejected = await bridge.dispatch({ type: 'rejectTransition', code, recoverable: true })
    mirrorSnapshot(rejected)
    const restored = songForSelection(rejected.current)
    if (restored) loadSong(restored)
    return rejected
  }

  const playPreparedTransition = async (snapshot: PlaybackSnapshot): Promise<void> => {
    if (!snapshot.current) {
      mirrorSnapshot(snapshot)
      return
    }

    const song = songForSelection(snapshot.current)
    if (!song) {
      await rejectPreparedTransition(snapshot, 'unavailable')
      throw new Error(PLAYBACK_ERROR_MESSAGE)
    }
    if (transport.loadedSongId !== song.id) loadSong(song)

    try {
      await transport.play()
      const committed = snapshot.transitionPending
        ? await bridge.dispatch({ type: 'commitTransition' })
        : await bridge.dispatch({ type: 'play' })
      mirrorSnapshot(committed)
    } catch {
      try {
        await rejectPreparedTransition(snapshot, 'decoder')
      } catch {
        recordPlaybackFailure(store)
      }
      throw new Error(PLAYBACK_ERROR_MESSAGE)
    }
  }

  const runTransition = async (command: PlaybackCommand): Promise<void> => {
    if (transitionTask) return
    const operation = (async () => {
      const snapshot = await bridge.dispatch(command)
      if (snapshot.transitionPending) await playPreparedTransition(snapshot)
      else if (
        snapshot.current &&
        (command.type === 'next' || command.type === 'ended' || command.type === 'replaceContext')
      ) {
        transport.currentTime = snapshot.positionMs / 1000
        await playPreparedTransition(snapshot)
      } else {
        mirrorSnapshot(snapshot)
        if (!snapshot.current) transport.pause()
        else if (command.type === 'previous') transport.currentTime = snapshot.positionMs / 1000
      }
    })()
    transitionTask = operation
    operation.then(
      () => {
        if (transitionTask === operation) transitionTask = undefined
      },
      () => {
        if (transitionTask === operation) transitionTask = undefined
      }
    )
    return operation
  }

  const waitForTransition = async (): Promise<void> => {
    try {
      await transitionTask
    } catch {
      // The transition already reported a generic playback failure.
    }
  }

  const initialize = async () => {
    let snapshot = await bridge.getSnapshot()
    if (snapshot.transitionPending) {
      snapshot = await bridge.dispatch({ type: 'rejectTransition', code: 'unknown', recoverable: true })
    }
    mirrorSnapshot(snapshot)
  }

  const playSong = async (song: Song, index: number) => {
    const validContext = store.playlist[index]?.id === song.id
    const context = validContext ? store.playlist : [song]
    if (!validContext) store.playlist = context
    await runTransition({
      type: 'replaceContext',
      autoplay: true,
      startIndex: validContext ? index : 0,
      trackIds: context.map((track) => track.id),
    })
  }

  const resumeSong = async () => {
    await waitForTransition()
    try {
      await transport.play()
      mirrorSnapshot(await bridge.dispatch({ type: 'play' }))
    } catch {
      try {
        mirrorSnapshot(await bridge.dispatch({ type: 'reportError', code: 'decoder', recoverable: true }))
      } catch {
        recordPlaybackFailure(store)
      }
      throw new Error(PLAYBACK_ERROR_MESSAGE)
    }
  }

  return {
    clearPlayback: async () => {
      await waitForTransition()
      transport.clear()
      await bridge.dispatch({ type: 'replaceContext', autoplay: false, startIndex: 0, trackIds: [] })
      const snapshot = await bridge.dispatch({ type: 'clearUpcoming' })
      queuedSongs.clear()
      store.playlist = []
      mirrorSnapshot(snapshot)
    },
    enqueueSong: async (song) => {
      await waitForTransition()
      const entryId = createQueueId()
      queuedSongs.set(entryId, song)
      try {
        mirrorSnapshot(await bridge.dispatch({ type: 'enqueue', entries: [{ entryId, trackId: song.id }] }))
      } catch (error) {
        queuedSongs.delete(entryId)
        throw error
      }
    },
    handleEnded: () => runTransition({ type: 'ended' }),
    handleMediaError: async () => {
      if (transitionTask) return
      try {
        mirrorSnapshot(await bridge.dispatch({ type: 'reportError', code: 'decoder', recoverable: true }))
      } catch {
        recordPlaybackFailure(store)
      }
    },
    initialize,
    nextSong: () => {
      const first = store.playlist[0]
      return !store.player.currSong && first ? playSong(first, 0) : runTransition({ type: 'next' })
    },
    observePosition: async () => {
      if (transitionTask) return
      const trackId = transport.loadedSongId
      if (!trackId || !Number.isFinite(transport.duration) || transport.duration <= 0) return
      try {
        await bridge.observePosition(trackId, milliseconds(transport.currentTime), milliseconds(transport.duration))
      } catch {
        // A concurrent transition or stale media event is safe to ignore.
      }
    },
    pauseSong: async () => {
      await waitForTransition()
      transport.pause()
      mirrorSnapshot(await bridge.dispatch({ type: 'pause' }))
    },
    playSong,
    prevSong: () => {
      const lastIndex = store.playlist.length - 1
      const last = store.playlist[lastIndex]
      return !store.player.currSong && last ? playSong(last, lastIndex) : runTransition({ type: 'previous' })
    },
    resumeSong,
    seekSong: async (positionSeconds) => {
      await waitForTransition()
      transport.currentTime = positionSeconds
      store.player.currentTime = positionSeconds
      const trackId = transport.loadedSongId
      if (trackId && Number.isFinite(transport.duration) && transport.duration > 0) {
        await bridge.observePosition(trackId, milliseconds(positionSeconds), milliseconds(transport.duration))
      }
    },
  }
}

export function bindPlaybackEvents(
  store: PlaybackStore,
  transport: AudioTransport,
  controller: PlaybackController
): () => void {
  let lastPositionObservation = 0
  const observePosition = (force = false) => {
    const now = Date.now()
    if (!force && now - lastPositionObservation < POSITION_OBSERVATION_INTERVAL_MS) return
    lastPositionObservation = now
    void controller.observePosition()
  }
  const unsubscribe = [
    transport.subscribe('durationchange', () => {
      store.player.duration = Number.isFinite(transport.duration) ? transport.duration : 0
      observePosition(true)
    }),
    transport.subscribe('timeupdate', () => {
      store.player.currentTime = transport.currentTime
      observePosition()
    }),
    transport.subscribe('play', () => {
      store.player.isPaused = false
    }),
    transport.subscribe('pause', () => {
      store.player.isPaused = true
    }),
    transport.subscribe('ended', () => {
      void controller.handleEnded().catch(() => undefined)
    }),
    transport.subscribe('error', () => {
      void controller.handleMediaError()
    }),
  ]

  return () => {
    for (const removeListener of unsubscribe) removeListener()
  }
}

export const AudioPlayerState = {
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

export function useAudioPlayer(store: Store) {
  const controller = useSignal<NoSerialize<PlaybackController>>()

  const playSong = $(async (song: Song, index: number) => controller.value?.playSong(song, index))
  const pauseSong = $(async () => controller.value?.pauseSong())
  const resumeSong = $(async () => controller.value?.resumeSong())
  const nextSong = $(async () => controller.value?.nextSong())
  const prevSong = $(async () => controller.value?.prevSong())
  const enqueueSong = $(async (song: Song) => controller.value?.enqueueSong(song))
  const clearPlayback = $(async () => controller.value?.clearPlayback())
  const seekSong = $(async (positionSeconds: number) => controller.value?.seekSong(positionSeconds))

  useVisibleTask$(({ cleanup }) => {
    if (store.player.audioElem) return

    const audioElement = new Audio()
    const transport = new BrowserAudioTransport(audioElement)
    const playbackController = createPlaybackController(store, transport, convertFileSrc, new NativePlaybackBridge())
    let disposed = false
    let unbindEvents = () => {}

    void playbackController
      .initialize()
      .then(() => {
        if (disposed) return
        unbindEvents = bindPlaybackEvents(store, transport, playbackController)
        controller.value = noSerialize(playbackController)
        store.player.audioElem = audioElement
      })
      .catch(() => {
        if (!disposed) recordPlaybackFailure(store)
      })

    cleanup(() => {
      disposed = true
      controller.value = undefined
      unbindEvents()
      transport.clear()
      store.player.audioElem = undefined
    })
  })

  return {
    clearPlayback,
    enqueueSong,
    nextSong,
    pauseSong,
    playSong,
    prevSong,
    resumeSong,
    seekSong,
  }
}

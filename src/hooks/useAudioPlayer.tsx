import { $, noSerialize, useSignal, useVisibleTask$, type NoSerialize } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'

import type { PlaybackSource, Song, Store } from '~/App'
import { BrowserAudioTransport, type AudioTransport } from '~/services/audio-transport'
import { resolvePlaybackTracks } from '~/services/library-client'
import { authorizePlaybackSource, PlaybackSourceAccessError } from '~/services/media-source'
import { bindPlaybackMediaActions, syncPlaybackMediaSession } from '~/services/media-session'
import {
  NativePlaybackBridge,
  type PlaybackBridge,
  type PlaybackCommand,
  type PlaybackSelection,
  type PlaybackSnapshot,
} from '~/services/playback-client'
import {
  commitPlaybackView,
  PLAYBACK_ACCESS_ERROR_MESSAGE,
  PLAYBACK_ERROR_MESSAGE,
  projectPlaybackView,
} from '~/services/playback-view'

export {
  PLAYBACK_ACCESS_ERROR_MESSAGE,
  PLAYBACK_ERROR_MESSAGE,
  PLAYBACK_PERSISTENCE_WARNING_MESSAGE,
} from '~/services/playback-view'

const POSITION_OBSERVATION_INTERVAL_MS = 250
let queueSequence = 0

type PlaybackClientEvent =
  | 'activation_requested'
  | 'controller_unavailable'
  | 'initialization_failed'
  | 'initializing'
  | 'media_play_failed'
  | 'ready'
  | 'source_authorization_failed'

type PlaybackStore = Pick<Store, 'playback'>
type QueueIdFactory = () => string
type SourceResolver = (song: Song) => Promise<string>
type TrackResolver = (trackIds: string[]) => Promise<Song[]>

interface ScheduledTransition {
  command: PlaybackCommand
  context?: Song[]
  source?: PlaybackSource
  reject(error: unknown): void
  resolve(): void
}

export interface PlaybackController {
  clearUpcoming(): Promise<void>
  clearPlayback(): Promise<void>
  enqueueSong(song: Song): Promise<void>
  handleEnded(): Promise<void>
  handleMediaError(): Promise<void>
  initialize(): Promise<void>
  moveQueuedSong(entryId: string, beforeEntryId?: string | null): Promise<void>
  nextSong(): Promise<void>
  observePosition(): Promise<void>
  pauseSong(): Promise<void>
  playSong(song: Song, index: number, source?: PlaybackSource): Promise<void>
  playTracks(songs: Song[], index: number, source?: PlaybackSource): Promise<void>
  prevSong(): Promise<void>
  resumeSong(): Promise<void>
  removeQueuedSong(entryId: string): Promise<void>
  seekSong(positionSeconds: number): Promise<void>
  setMuted(muted: boolean): Promise<void>
  setRepeatMode(repeatMode: PlaybackSnapshot['repeatMode']): Promise<void>
  setShuffleEnabled(enabled: boolean): Promise<void>
  setVolumePercent(volumePercent: number): Promise<void>
  undoQueueEdit(): Promise<void>
}

function defaultQueueId(): string {
  queueSequence += 1
  return `queue-${Date.now().toString(36)}-${queueSequence.toString(36)}`
}

function milliseconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0
}

function recordPlaybackFailure(store: PlaybackStore): void {
  store.playback.error = PLAYBACK_ERROR_MESSAGE
  store.playback.isPaused = true
}

function recordSourceFailure(store: PlaybackStore, error: unknown): void {
  store.playback.error =
    error instanceof PlaybackSourceAccessError ? PLAYBACK_ACCESS_ERROR_MESSAGE : PLAYBACK_ERROR_MESSAGE
  store.playback.isPaused = true
}

function recordPlaybackClientEvent(event: PlaybackClientEvent): void {
  void invoke('record_playback_client_event', { event }).catch(() => undefined)
}

export function createPlaybackController(
  store: PlaybackStore,
  transport: AudioTransport,
  resolveSource: SourceResolver,
  bridge: PlaybackBridge,
  createQueueId: QueueIdFactory = defaultQueueId,
  resolveTracks: TrackResolver = resolvePlaybackTracks
): PlaybackController {
  const queuedSongs = new Map<string, Song>()
  let undoEntryIds = new Set<string>()
  let transitionTask: Promise<void> | undefined
  let scheduledTransition: ScheduledTransition | undefined

  const loadSong = async (song: Song) => {
    transport.load(await resolveSource(song), song.id)
  }

  const songForSelection = (
    selection?: PlaybackSelection | null,
    context: Song[] = store.playback.context
  ): Song | undefined => {
    if (!selection) return undefined
    if (selection.queueEntryId) {
      const queued = queuedSongs.get(selection.queueEntryId)
      if (queued) return queued
    }
    if (selection.contextIndex !== null && selection.contextIndex !== undefined) {
      const contextual = context[selection.contextIndex]
      if (contextual?.id === selection.trackId) return contextual
    }
    if (store.playback.current?.id === selection.trackId) return store.playback.current
    return (
      context.find((song) => song.id === selection.trackId) ||
      [...queuedSongs.values()].find((song) => song.id === selection.trackId)
    )
  }

  const mirrorSnapshot = (
    snapshot: PlaybackSnapshot,
    projection: { context?: Song[]; replaceContext?: boolean; source?: PlaybackSource } = {}
  ): void => {
    const context = projection.context ?? store.playback.context
    const source = projection.replaceContext ? projection.source : store.playback.source
    const current = songForSelection(snapshot.current, context)
    const queue = snapshot.queue.flatMap((entry) => {
      const song = queuedSongs.get(entry.entryId)
      return song ? [{ entryId: entry.entryId, song }] : []
    })

    const playback = projectPlaybackView(snapshot, { context, current, queue, source })
    if (
      current &&
      transport.loadedSongId === current.id &&
      Number.isFinite(transport.duration) &&
      transport.duration > 0
    ) {
      playback.duration = transport.duration
    }
    commitPlaybackView(store.playback, playback)
    transport.muted = snapshot.muted
    transport.volume = snapshot.volumePercent / 100

    const retainedEntryIds = new Set(
      [snapshot.current, ...snapshot.history]
        .map((selection) => selection?.queueEntryId)
        .filter((entryId): entryId is string => Boolean(entryId))
    )
    for (const entry of snapshot.queue) retainedEntryIds.add(entry.entryId)
    if (snapshot.canUndoQueueEdit) {
      for (const entryId of undoEntryIds) retainedEntryIds.add(entryId)
    } else {
      undoEntryIds.clear()
    }
    for (const entryId of queuedSongs.keys()) {
      if (!retainedEntryIds.has(entryId)) queuedSongs.delete(entryId)
    }
  }

  const rejectPreparedTransition = async (snapshot: PlaybackSnapshot, code: 'decoder' | 'unavailable') => {
    if (!snapshot.transitionPending) return snapshot
    const rejected = await bridge.dispatch({ type: 'rejectTransition', code, recoverable: true })
    mirrorSnapshot(rejected)
    const restored = songForSelection(rejected.current)
    if (restored) await loadSong(restored)
    return rejected
  }

  const playPreparedTransition = async (
    snapshot: PlaybackSnapshot,
    projection: { context?: Song[]; replaceContext?: boolean; source?: PlaybackSource } = {}
  ): Promise<void> => {
    if (!snapshot.current) {
      mirrorSnapshot(snapshot, projection)
      return
    }

    const song = songForSelection(snapshot.current, projection.context)
    if (!song) {
      await rejectPreparedTransition(snapshot, 'unavailable')
      throw new Error(PLAYBACK_ERROR_MESSAGE)
    }
    if (transport.loadedSongId !== song.id) {
      try {
        await loadSong(song)
      } catch (error) {
        recordPlaybackClientEvent('source_authorization_failed')
        try {
          await rejectPreparedTransition(snapshot, 'unavailable')
        } catch {
          recordPlaybackFailure(store)
        }
        recordSourceFailure(store, error)
        throw new Error(PLAYBACK_ERROR_MESSAGE)
      }
    }

    try {
      await transport.play()
      const committed = snapshot.transitionPending
        ? await bridge.dispatch({ type: 'commitTransition' })
        : await bridge.dispatch({ type: 'play' })
      mirrorSnapshot(committed, projection)
    } catch {
      recordPlaybackClientEvent('media_play_failed')
      try {
        await rejectPreparedTransition(snapshot, 'decoder')
      } catch {
        recordPlaybackFailure(store)
      }
      throw new Error(PLAYBACK_ERROR_MESSAGE)
    }
  }

  const executeTransition = async (
    command: PlaybackCommand,
    context?: Song[],
    source?: PlaybackSource
  ): Promise<void> => {
    const projection = { context, replaceContext: context !== undefined, source }
    const snapshot = await bridge.dispatch(command)
    if (snapshot.transitionPending) await playPreparedTransition(snapshot, projection)
    else if (
      snapshot.current &&
      (command.type === 'next' || command.type === 'ended' || command.type === 'replaceContext')
    ) {
      transport.currentTime = snapshot.positionMs / 1000
      await playPreparedTransition(snapshot, projection)
    } else {
      mirrorSnapshot(snapshot, projection)
      if (!snapshot.current) transport.pause()
      else if (command.type === 'previous') transport.currentTime = snapshot.positionMs / 1000
    }
  }

  const drainTransitions = async (initial: ScheduledTransition): Promise<void> => {
    let request: ScheduledTransition | undefined = initial
    while (request) {
      try {
        await executeTransition(request.command, request.context, request.source)
        request.resolve()
      } catch (error) {
        request.reject(error)
      }
      request = scheduledTransition
      scheduledTransition = undefined
    }
  }

  const runTransition = (command: PlaybackCommand, context?: Song[], source?: PlaybackSource): Promise<void> => {
    if (transitionTask && command.type !== 'replaceContext') return transitionTask
    return new Promise((resolve, reject) => {
      const request: ScheduledTransition = { command, context, source, reject, resolve }
      if (transitionTask) {
        scheduledTransition?.resolve()
        scheduledTransition = request
        return
      }

      const operation = drainTransitions(request)
      transitionTask = operation
      void operation.finally(() => {
        if (transitionTask === operation) transitionTask = undefined
      })
    })
  }

  const waitForTransition = async (): Promise<void> => {
    try {
      await transitionTask
    } catch {
      // The transition already reported a generic playback failure.
    }
  }

  const dispatchQueueEdit = async (command: PlaybackCommand): Promise<void> => {
    const previousUndoEntryIds = undoEntryIds
    const previousQueueEntryIds = store.playback.queue.map((entry) => entry.entryId)
    undoEntryIds = new Set(previousQueueEntryIds)
    try {
      const snapshot = await bridge.dispatch(command)
      if (
        snapshot.queue.length === previousQueueEntryIds.length &&
        snapshot.queue.every((entry, index) => entry.entryId === previousQueueEntryIds[index])
      ) {
        undoEntryIds = previousUndoEntryIds
      }
      mirrorSnapshot(snapshot)
    } catch (error) {
      undoEntryIds = previousUndoEntryIds
      throw error
    }
  }

  const initialize = async () => {
    let snapshot = await bridge.getSnapshot()
    if (snapshot.transitionPending) {
      snapshot = await bridge.dispatch({ type: 'rejectTransition', code: 'unknown', recoverable: true })
    }
    const trackIds = [
      ...snapshot.context.trackIds,
      ...snapshot.queue.map((entry) => entry.trackId),
      ...(snapshot.current ? [snapshot.current.trackId] : []),
    ].filter((trackId, index, all) => all.indexOf(trackId) === index)
    let context = snapshot.context.trackIds.length ? [] : store.playback.context
    if (trackIds.length) {
      const resolved = await resolveTracks(trackIds)
      const byId = new Map(resolved.map((track) => [track.id, track]))
      const resolvedContext = snapshot.context.trackIds.map((trackId) => byId.get(trackId))
      if (resolvedContext.every((track): track is Song => Boolean(track))) context = resolvedContext
      for (const entry of snapshot.queue) {
        const track = byId.get(entry.trackId)
        if (track) queuedSongs.set(entry.entryId, track)
      }
      if (snapshot.current?.queueEntryId) {
        const track = byId.get(snapshot.current.trackId)
        if (track) queuedSongs.set(snapshot.current.queueEntryId, track)
      }
    }
    mirrorSnapshot(snapshot, { context, replaceContext: true })
  }

  const playTracks = async (songs: Song[], index: number, source?: PlaybackSource) => {
    if (!songs[index]) return
    const context = [...songs]
    await runTransition(
      {
        type: 'replaceContext',
        autoplay: true,
        startIndex: index,
        trackIds: context.map((track) => track.id),
      },
      context,
      source
    )
  }

  const playSong = async (song: Song, index: number, source?: PlaybackSource) => {
    const validContext = store.playback.context[index]?.id === song.id
    await playTracks(validContext ? store.playback.context : [song], validContext ? index : 0, source)
  }

  const resumeSong = async () => {
    await waitForTransition()
    const current = store.playback.current
    if (current && transport.loadedSongId !== current.id) {
      try {
        await loadSong(current)
        transport.currentTime = store.playback.currentTime
      } catch (error) {
        recordPlaybackClientEvent('source_authorization_failed')
        try {
          mirrorSnapshot(await bridge.dispatch({ type: 'reportError', code: 'unavailable', recoverable: true }))
        } catch {
          recordPlaybackFailure(store)
        }
        recordSourceFailure(store, error)
        throw new Error(PLAYBACK_ERROR_MESSAGE)
      }
    }
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
    clearUpcoming: async () => {
      await waitForTransition()
      await dispatchQueueEdit({ type: 'clearUpcoming' })
    },
    clearPlayback: async () => {
      await waitForTransition()
      transport.clear()
      await bridge.dispatch({ type: 'replaceContext', autoplay: false, startIndex: 0, trackIds: [] })
      await bridge.dispatch({ type: 'clearUpcoming' })
      const snapshot = await bridge.dispatch({ type: 'discardQueueUndo' })
      queuedSongs.clear()
      undoEntryIds.clear()
      mirrorSnapshot(snapshot, { context: [], replaceContext: true })
    },
    enqueueSong: async (song) => {
      await waitForTransition()
      const entryId = createQueueId()
      queuedSongs.set(entryId, song)
      try {
        await dispatchQueueEdit({ type: 'enqueue', entries: [{ entryId, trackId: song.id }] })
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
    moveQueuedSong: async (entryId, beforeEntryId) => {
      await waitForTransition()
      await dispatchQueueEdit({ type: 'moveQueueEntry', entryId, beforeEntryId })
    },
    nextSong: () => {
      const first = store.playback.context[0]
      return !store.playback.current && first
        ? playSong(first, 0, store.playback.source)
        : runTransition({ type: 'next' })
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
    playTracks,
    prevSong: () => {
      const lastIndex = store.playback.context.length - 1
      const last = store.playback.context[lastIndex]
      return !store.playback.current && last
        ? playSong(last, lastIndex, store.playback.source)
        : runTransition({ type: 'previous' })
    },
    resumeSong,
    removeQueuedSong: async (entryId) => {
      await waitForTransition()
      await dispatchQueueEdit({ type: 'removeQueueEntry', entryId })
    },
    seekSong: async (positionSeconds) => {
      await waitForTransition()
      transport.currentTime = positionSeconds
      store.playback.currentTime = positionSeconds
      const trackId = transport.loadedSongId
      if (trackId && Number.isFinite(transport.duration) && transport.duration > 0) {
        await bridge.observePosition(trackId, milliseconds(positionSeconds), milliseconds(transport.duration))
      }
    },
    setMuted: async (muted) => {
      await waitForTransition()
      mirrorSnapshot(
        await bridge.dispatch({
          type: 'setVolume',
          muted,
          volumePercent: store.playback.volumePercent,
        })
      )
    },
    setRepeatMode: async (repeatMode) => {
      await waitForTransition()
      mirrorSnapshot(await bridge.dispatch({ type: 'setRepeat', repeatMode }))
    },
    setShuffleEnabled: async (enabled) => {
      await waitForTransition()
      mirrorSnapshot(
        await bridge.dispatch({
          type: 'setShuffle',
          enabled,
          seed: enabled ? Date.now() : store.playback.shuffleSeed,
        })
      )
    },
    setVolumePercent: async (volumePercent) => {
      await waitForTransition()
      const boundedVolume = Math.max(0, Math.min(100, Math.round(volumePercent)))
      mirrorSnapshot(
        await bridge.dispatch({
          type: 'setVolume',
          muted: boundedVolume === 0,
          volumePercent: boundedVolume,
        })
      )
    },
    undoQueueEdit: async () => {
      await waitForTransition()
      const snapshot = await bridge.dispatch({ type: 'undoQueueEdit' })
      undoEntryIds.clear()
      mirrorSnapshot(snapshot)
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
      store.playback.duration = Number.isFinite(transport.duration) ? transport.duration : 0
      observePosition(true)
    }),
    transport.subscribe('timeupdate', () => {
      store.playback.currentTime = transport.currentTime
      if (Number.isFinite(transport.duration) && transport.duration > 0) {
        store.playback.duration = transport.duration
      }
      observePosition()
    }),
    transport.subscribe('play', () => {
      store.playback.isPaused = false
    }),
    transport.subscribe('pause', () => {
      store.playback.isPaused = true
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

export function useAudioPlayer(store: Store) {
  const controller = useSignal<NoSerialize<PlaybackController>>()

  const playSong = $(async (song: Song, index: number, source?: PlaybackSource) => {
    if (!controller.value) {
      recordPlaybackClientEvent('controller_unavailable')
      recordPlaybackFailure(store)
      throw new Error(PLAYBACK_ERROR_MESSAGE)
    }
    return controller.value.playSong(song, index, source)
  })
  const playTracks = $(async (songs: Song[], index: number, source?: PlaybackSource) => {
    if (!controller.value) {
      recordPlaybackClientEvent('controller_unavailable')
      recordPlaybackFailure(store)
      throw new Error(PLAYBACK_ERROR_MESSAGE)
    }
    return controller.value.playTracks(songs, index, source)
  })
  const pauseSong = $(async () => controller.value?.pauseSong())
  const resumeSong = $(async () => controller.value?.resumeSong())
  const nextSong = $(async () => controller.value?.nextSong())
  const prevSong = $(async () => controller.value?.prevSong())
  const enqueueSong = $(async (song: Song) => controller.value?.enqueueSong(song))
  const removeQueuedSong = $(async (entryId: string) => controller.value?.removeQueuedSong(entryId))
  const moveQueuedSong = $(async (entryId: string, beforeEntryId?: string | null) =>
    controller.value?.moveQueuedSong(entryId, beforeEntryId)
  )
  const clearUpcoming = $(async () => controller.value?.clearUpcoming())
  const clearPlayback = $(async () => controller.value?.clearPlayback())
  const seekSong = $(async (positionSeconds: number) => controller.value?.seekSong(positionSeconds))
  const setMuted = $(async (muted: boolean) => controller.value?.setMuted(muted))
  const setRepeatMode = $(async (repeatMode: PlaybackSnapshot['repeatMode']) =>
    controller.value?.setRepeatMode(repeatMode)
  )
  const setShuffleEnabled = $(async (enabled: boolean) => controller.value?.setShuffleEnabled(enabled))
  const setVolumePercent = $(async (volumePercent: number) => controller.value?.setVolumePercent(volumePercent))
  const undoQueueEdit = $(async () => controller.value?.undoQueueEdit())

  useVisibleTask$(({ cleanup }) => {
    recordPlaybackClientEvent('initializing')

    const audioElement = new Audio()
    const transport = new BrowserAudioTransport(audioElement)
    const playbackController = createPlaybackController(
      store,
      transport,
      authorizePlaybackSource,
      new NativePlaybackBridge()
    )
    let disposed = false
    let unbindEvents = () => {}
    let unbindMediaActions = () => {}

    void playbackController
      .initialize()
      .then(() => {
        if (disposed) return
        unbindEvents = bindPlaybackEvents(store, transport, playbackController)
        if ('mediaSession' in navigator) {
          unbindMediaActions = bindPlaybackMediaActions(navigator.mediaSession, {
            next: () => playbackController.nextSong(),
            pause: () => playbackController.pauseSong(),
            play: () => playbackController.resumeSong(),
            previous: () => playbackController.prevSong(),
          })
        }
        controller.value = noSerialize(playbackController)
        recordPlaybackClientEvent('ready')
      })
      .catch(() => {
        if (!disposed) {
          recordPlaybackClientEvent('initialization_failed')
          recordPlaybackFailure(store)
        }
      })

    cleanup(() => {
      disposed = true
      controller.value = undefined
      unbindEvents()
      unbindMediaActions()
      transport.clear()
    })
  })

  useVisibleTask$(({ track }) => {
    const current = track(() => store.playback.current)
    const isPaused = track(() => store.playback.isPaused)
    if (!('mediaSession' in navigator)) return

    syncPlaybackMediaSession(
      navigator.mediaSession,
      current,
      isPaused,
      typeof MediaMetadata === 'function' ? (metadata) => new MediaMetadata(metadata) : undefined
    )
  })

  return {
    clearUpcoming,
    clearPlayback,
    enqueueSong,
    moveQueuedSong,
    nextSong,
    pauseSong,
    playSong,
    playTracks,
    prevSong,
    resumeSong,
    removeQueuedSong,
    seekSong,
    setMuted,
    setRepeatMode,
    setShuffleEnabled,
    setVolumePercent,
    undoQueueEdit,
  }
}

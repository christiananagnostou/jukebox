import { $, noSerialize, useSignal, useVisibleTask$, type NoSerialize } from '@builder.io/qwik'
import { convertFileSrc } from '@tauri-apps/api/core'

import type { Song, Store } from '~/App'
import { BrowserAudioTransport, type AudioTransport } from '~/services/audio-transport'
import {
  consumePlayedQueueHead,
  decideNextPlayback,
  decidePreviousPlayback,
  type PlaybackCandidate,
} from '~/services/playback-state'

export const PLAYBACK_ERROR_MESSAGE = 'This track could not be played'

type PlaybackStore = Pick<Store, 'player' | 'playlist' | 'queue'>
type SourceResolver = (path: string) => string

export interface PlaybackController {
  handleMediaError(): void
  loadSong(song: Song): void
  nextSong(): Promise<void>
  pauseSong(): void
  playSong(song: Song, index: number): Promise<void>
  prevSong(): Promise<void>
  resumeSong(): Promise<void>
}

function recordPlaybackFailure(store: PlaybackStore): void {
  store.player.error = PLAYBACK_ERROR_MESSAGE
  store.player.isPaused = true
}

export function createPlaybackController(
  store: PlaybackStore,
  transport: AudioTransport,
  resolveSource: SourceResolver
): PlaybackController {
  let transitionPending = false

  const loadSong = (song: Song) => {
    transport.load(resolveSource(song.path), song.id)
  }

  const playSong = async (song: Song, index: number) => {
    if (transport.loadedSongId !== song.id) loadSong(song)

    try {
      await transport.play()
      store.player.currSong = song
      store.player.currSongIndex = index
      store.player.error = ''
      store.player.isPaused = false
    } catch {
      recordPlaybackFailure(store)
      throw new Error(PLAYBACK_ERROR_MESSAGE)
    }
  }

  const playTransition = async (candidate: PlaybackCandidate) => {
    if (candidate.kind !== 'play') return
    await playSong(candidate.song, candidate.playlistIndex)
    if (candidate.source === 'queue') store.queue = consumePlayedQueueHead(store.queue, candidate)
  }

  const nextSong = async () => {
    if (transitionPending) return
    transitionPending = true
    try {
      await playTransition(decideNextPlayback(store.queue, store.playlist, store.player.currSongIndex))
    } finally {
      transitionPending = false
    }
  }

  const prevSong = async () => {
    if (transitionPending) return
    transitionPending = true
    try {
      const decision = decidePreviousPlayback(store.playlist, store.player.currSongIndex, store.player.currentTime)
      if (decision.kind === 'restart') {
        transport.currentTime = 0
        store.player.currentTime = 0
      } else {
        await playTransition(decision)
      }
    } finally {
      transitionPending = false
    }
  }

  const resumeSong = async () => {
    try {
      await transport.play()
      store.player.error = ''
      store.player.isPaused = false
    } catch {
      recordPlaybackFailure(store)
      throw new Error(PLAYBACK_ERROR_MESSAGE)
    }
  }

  return {
    handleMediaError: () => recordPlaybackFailure(store),
    loadSong,
    nextSong,
    pauseSong: () => transport.pause(),
    playSong,
    prevSong,
    resumeSong,
  }
}

export function bindPlaybackEvents(
  store: PlaybackStore,
  transport: AudioTransport,
  controller: PlaybackController
): () => void {
  const unsubscribe = [
    transport.subscribe('durationchange', () => {
      store.player.duration = Number.isFinite(transport.duration) ? transport.duration : 0
    }),
    transport.subscribe('timeupdate', () => {
      store.player.currentTime = transport.currentTime
    }),
    transport.subscribe('play', () => {
      store.player.isPaused = false
    }),
    transport.subscribe('pause', () => {
      store.player.isPaused = true
    }),
    transport.subscribe('ended', () => {
      void controller.nextSong().catch(() => undefined)
    }),
    transport.subscribe('error', () => {
      controller.handleMediaError()
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

  const loadSong = $((song: Song) => controller.value?.loadSong(song))
  const playSong = $(async (song: Song, index: number) => controller.value?.playSong(song, index))
  const pauseSong = $(() => controller.value?.pauseSong())
  const resumeSong = $(async () => controller.value?.resumeSong())
  const nextSong = $(async () => controller.value?.nextSong())
  const prevSong = $(async () => controller.value?.prevSong())

  useVisibleTask$(({ cleanup }) => {
    if (store.player.audioElem) return

    const audioElement = new Audio()
    const transport = new BrowserAudioTransport(audioElement)
    const playbackController = createPlaybackController(store, transport, convertFileSrc)
    const unbindEvents = bindPlaybackEvents(store, transport, playbackController)
    controller.value = noSerialize(playbackController)
    store.player.audioElem = audioElement

    cleanup(() => {
      controller.value = undefined
      unbindEvents()
      transport.clear()
      store.player.audioElem = undefined
    })
  })

  return {
    loadSong,
    playSong,
    pauseSong,
    resumeSong,
    nextSong,
    prevSong,
  }
}

import { $, useVisibleTask$ } from '@builder.io/qwik'
import { convertFileSrc } from '@tauri-apps/api/core'

import type { Song, Store } from '~/App'

export const AudioPlayerState = {
  player: {
    currSong: undefined,
    currSongIndex: 0,
    audioElem: undefined,
    isPaused: true,
    currentTime: 0,
    duration: 0,
  },
}

export function useAudioPlayer(store: Store) {
  const loadSong = $((song: Song) => {
    const audioElement = store.player.audioElem
    if (!audioElement) return

    audioElement.src = convertFileSrc(song.path)
    audioElement.dataset.loadedSongId = song.id
    audioElement.load()
  })

  const playSong = $(async (song: Song, index: number) => {
    const audioElement = store.player.audioElem
    if (!audioElement || !song) return

    if (audioElement.dataset.loadedSongId !== song.id) {
      await loadSong(song)
    }

    store.player.currSong = song
    store.player.currSongIndex = index

    try {
      await audioElement.play()
    } catch (error) {
      store.player.isPaused = true
      throw error
    }
  })

  const pauseSong = $(() => {
    store.player.audioElem?.pause()
  })

  const resumeSong = $(async () => {
    const audioElement = store.player.audioElem
    if (audioElement) await audioElement.play()
  })

  const nextSong = $(async () => {
    const queuedSong = store.queue.shift()
    if (queuedSong) {
      await playSong(queuedSong, store.player.currSongIndex)
      return
    }

    if (!store.playlist.length) return
    const nextIndex = store.player.currSongIndex >= store.playlist.length - 1 ? 0 : store.player.currSongIndex + 1
    await playSong(store.playlist[nextIndex], nextIndex)
  })

  const prevSong = $(async () => {
    const audioElement = store.player.audioElem
    if (!audioElement) return

    if (store.player.currentTime > 10) {
      audioElement.currentTime = 0
      return
    }

    if (!store.playlist.length) return
    const prevIndex = store.player.currSongIndex <= 0 ? store.playlist.length - 1 : store.player.currSongIndex - 1
    await playSong(store.playlist[prevIndex], prevIndex)
  })

  useVisibleTask$(({ cleanup }) => {
    if (store.player.audioElem) return

    const audioElement = new Audio()
    const updateDuration = () => {
      store.player.duration = Number.isFinite(audioElement.duration) ? audioElement.duration : 0
    }
    const updateCurrentTime = () => {
      store.player.currentTime = audioElement.currentTime
    }
    const markPlaying = () => {
      store.player.isPaused = false
    }
    const markPaused = () => {
      store.player.isPaused = true
    }

    audioElement.addEventListener('durationchange', updateDuration)
    audioElement.addEventListener('timeupdate', updateCurrentTime)
    audioElement.addEventListener('play', markPlaying)
    audioElement.addEventListener('pause', markPaused)
    audioElement.addEventListener('ended', nextSong)
    audioElement.addEventListener('error', markPaused)
    store.player.audioElem = audioElement

    cleanup(() => {
      audioElement.pause()
      audioElement.removeEventListener('durationchange', updateDuration)
      audioElement.removeEventListener('timeupdate', updateCurrentTime)
      audioElement.removeEventListener('play', markPlaying)
      audioElement.removeEventListener('pause', markPaused)
      audioElement.removeEventListener('ended', nextSong)
      audioElement.removeEventListener('error', markPaused)
      audioElement.removeAttribute('src')
      audioElement.load()
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

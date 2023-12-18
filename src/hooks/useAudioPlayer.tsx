import type { Store, Song } from '~/App'
import { $ } from '@builder.io/qwik'
// @ts-ignore
import { convertFileSrc } from '@tauri-apps/api/tauri'

export const AudioPlayerState = {
  player: {
    currSong: undefined,
    currSongIndex: 0,
    audioElem: undefined,
    nextAudioElem: undefined,
    isPaused: true,
    currentTime: 0,
    duration: 0,
  },
}

export function useAudioPlayer(store: Store) {
  const loadSong = $((song: Song) => {
    if (!store.player.audioElem) return
    store.player.audioElem.src = convertFileSrc(song.path)
    store.player.audioElem.dataset.loadedSongId = song.id
    store.player.audioElem.load()
  })

  const playSong = $(async (song: Song, index: number) => {
    if (!store.player.audioElem) return
    // Load the new song if not already loaded
    if (store.player.audioElem.dataset.loadedSongId !== song.id) await loadSong(song)
    store.player.currSong = song
    store.player.currSongIndex = index
    store.player.audioElem.play()
    store.player.isPaused = false
  })

  const pauseSong = $(() => {
    store.player.audioElem?.pause()
    store.player.isPaused = true
  })

  const resumeSong = $(() => {
    store.player.audioElem?.play()
    store.player.isPaused = false
  })

  const nextSong = $(() => {
    if (store.queue.length) {
      // Next Song in Queue
      const nextSong = store.queue.shift()
      if (nextSong) playSong(nextSong, store.player.currSongIndex) // After queue, songs will continue from next song before queue started
    } else {
      // Next Song in Order
      const nextIndex = store.player.currSongIndex >= store.playlist.length - 1 ? 0 : store.player.currSongIndex + 1
      playSong(store.playlist[nextIndex], nextIndex)
    }
  })

  const prevSong = $(() => {
    if (store.player.currentTime > 10) {
      // Restart Current Song
      if (store.player.audioElem) store.player.audioElem.currentTime = 0
    } else {
      const prevIndex = store.player.currSongIndex <= 0 ? store.playlist.length - 1 : store.player.currSongIndex - 1

      playSong(store.playlist[prevIndex], prevIndex)
    }
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

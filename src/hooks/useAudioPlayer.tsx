import type { Store, Song } from '~/App'
import { $, useVisibleTask$ } from '@builder.io/qwik'
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
  // const visualizeAudio = $(() => {
  //   if (!store.player.audioElem) return
  //   const audioContext = new window.AudioContext()

  //   const sourceNode = audioContext.createMediaElementSource(store.player.audioElem)
  //   const analyser = audioContext.createAnalyser()

  //   sourceNode.connect(analyser)
  //   analyser.connect(audioContext.destination)

  //   const frequencyData = new Uint8Array(analyser.frequencyBinCount)

  //   function updateFrequencyData() {
  //     analyser.getByteFrequencyData(frequencyData)

  //     // Use frequencyData for visualization or analysis
  //     console.log(frequencyData)
  //   }

  //   function update() {
  //     updateFrequencyData()
  //     // Update visualization or perform tasks based on the data
  //     requestAnimationFrame(update)
  //   }

  //   // Start updating data
  //   update()
  // })

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

    // visualizeAudio()
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

  useVisibleTask$(async () => {
    // Interval to update the pause/play state
    let interval: NodeJS.Timeout

    // Initialize an audio element
    if (!store.player.audioElem) {
      const audioElem = new Audio()
      // Listen for metadata being loaded into the audio element and set duration
      audioElem.addEventListener('loadedmetadata', () => (store.player.duration = audioElem.duration), false)

      // Listen for song ending to go to next
      audioElem.addEventListener('ended', nextSong)

      // Update current time
      audioElem.addEventListener('timeupdate', () => (store.player.currentTime = audioElem.currentTime))

      // Update pause/play state
      interval = setInterval(() => {
        if (audioElem.paused != store.player.isPaused) store.player.isPaused = audioElem.paused
      }, 333)

      // Set Audio Elem
      store.player.audioElem = audioElem
    }

    return () => clearInterval(interval)
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

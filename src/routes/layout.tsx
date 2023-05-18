import { $, component$, createContextId, Slot, useContextProvider, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { routeLoader$ } from '@builder.io/qwik-city'

import Nav from '~/components/starter/nav/nav'
import Footer from '~/components/starter/footer/footer'
import type { Song, Store, StoreActions } from '~/App'

export const useServerTimeLoader = routeLoader$(() => {
  return {
    date: new Date().toISOString(),
  }
})

export const StoreContext = createContextId<Store>('docs.store-context')
export const StoreActionsContext = createContextId<StoreActions>('docs.store-actions-context')

export default component$(() => {
  const store = useStore<Store>(
    {
      allSongs: [],
      searchTerm: '',
      audioDir: '',
      pathPrefix: 'asset://localhost/',
      player: {
        currSong: undefined,
        currSongIndex: 0,
        audioElem: undefined,
        nextAudioElem: undefined,
        isPaused: true,
        currentTime: 0,
        duration: 0,
      },
    },
    { deep: true }
  )
  useContextProvider(StoreContext, store)

  const loadSong = $((song: Song) => {
    if (!store.player.audioElem) return
    store.player.audioElem.src = store.pathPrefix + song.path
    store.player.audioElem.dataset.songId = song.id
    store.player.audioElem.load()
  })

  const playSong = $(async (song: Song, index?: number) => {
    if (!store.player.audioElem) return
    if (store.player.audioElem.dataset.songId !== song.id) await loadSong(song)
    store.player.currSong = song
    store.player.audioElem.play()
    store.player.isPaused = false
    if (index) store.player.currSongIndex = index
  })

  const nextSong = $(() => {
    const nextIndex = store.player.currSongIndex + 1
    if (nextIndex === store.allSongs.length) return
    playSong(store.allSongs[nextIndex], nextIndex)
  })

  const prevSong = $(() => {
    const prevIndex = store.player.currSongIndex - 1
    if (prevIndex < 0) return
    playSong(store.allSongs[prevIndex], prevIndex)
  })

  const storeActions = useStore<StoreActions>({
    loadSong,
    playSong,
    nextSong,
    prevSong,
  })
  useContextProvider(StoreActionsContext, storeActions)

  useVisibleTask$(() => {
    // Initialize an audio element
    let interval: NodeJS.Timer

    if (!store.player.audioElem) {
      const audioElem = new Audio()
      // Listen for metadata being loaded into the audio element and set duration
      audioElem.addEventListener('loadedmetadata', () => (store.player.duration = audioElem.duration), false)

      // Update currentTime and check to go to the next song
      interval = setInterval(() => {
        store.player.currentTime = audioElem.currentTime
        if (audioElem.ended && !store.player.isPaused) nextSong()
      }, 500)

      // Set Audio Elem
      store.player.audioElem = audioElem
    }

    return () => clearInterval(interval)
  })

  return (
    <>
      <Nav />

      <main class="h-screen max-h-screen w-full flex flex-col realtive ml-48">
        <Slot />
        <Footer />
      </main>
    </>
  )
})

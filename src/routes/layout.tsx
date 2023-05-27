import {
  $,
  component$,
  createContextId,
  Slot,
  useContextProvider,
  useStore,
  useTask$,
  useVisibleTask$,
} from '@builder.io/qwik'
import type { Song, Store, StoreActions } from '~/App'
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts'
import Nav from '~/components/nav'
import Footer from '~/components/footer'
import AudioSidebar from '~/components/audio-sidebar'
import { convertFileSrc } from '@tauri-apps/api/tauri'

export const StoreContext = createContextId<Store>('docs.store-context')
export const StoreActionsContext = createContextId<StoreActions>('docs.store-actions-context')

export default component$(() => {
  const store = useStore<Store>(
    {
      allSongs: [],
      displayedSongs: [],
      sorting: 'default',
      searchTerm: '',
      audioDir: '',
      highlightedIndex: 0,
      isTyping: false,
      showKeyShortcuts: false,
      queue: [],
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
      const nextIndex =
        store.player.currSongIndex >= store.displayedSongs.length - 1 ? 0 : store.player.currSongIndex + 1
      playSong(store.displayedSongs[nextIndex], nextIndex)
    }
  })

  const prevSong = $(() => {
    if (store.player.currentTime > 10) {
      // Restart Current Song
      if (store.player.audioElem) store.player.audioElem.currentTime = 0
    } else {
      const prevIndex =
        store.player.currSongIndex <= 0 ? store.displayedSongs.length - 1 : store.player.currSongIndex - 1

      playSong(store.displayedSongs[prevIndex], prevIndex)
    }
  })

  const storeActions = useStore<StoreActions>({
    loadSong,
    playSong,
    pauseSong,
    resumeSong,
    nextSong,
    prevSong,
  })
  useContextProvider(StoreActionsContext, storeActions)

  useKeyboardShortcuts(store, storeActions)

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

  // Song Sorting
  useTask$(({ track }) => {
    const sorting = track(() => store.sorting)
    track(() => store.searchTerm)

    store.allSongs = store.allSongs.sort((song1, song2) => {
      switch (sorting) {
        case 'title-desc':
          return song1.title.localeCompare(song2.title)
        case 'title-asc':
          return song2.title.localeCompare(song1.title)
        case 'artist-desc':
          return song1.artist.localeCompare(song2.artist)
        case 'artist-asc':
          return song2.artist.localeCompare(song1.artist)
        case 'album-desc':
          return song1.album.localeCompare(song2.album)
        case 'album-asc':
          return song2.album.localeCompare(song1.album)
        default:
          return 1
      }
    })
  })

  useTask$(({ track }) => {
    const searchTerm = track(() => store.searchTerm)
      .toLowerCase()
      .trim()
    const allSongs = track(() => store.allSongs)

    store.displayedSongs = searchTerm
      ? allSongs.filter(
          ({ title, artist, album }) =>
            title.toLowerCase().includes(searchTerm) ||
            artist.toLowerCase().includes(searchTerm) ||
            album.toLowerCase().includes(searchTerm)
        )
      : allSongs
  })

  return (
    <>
      <Nav />

      <main
        class="h-screen max-h-screen w-full flex flex-col realtive transition-[margin]"
        style={{
          marginLeft: 'var(--navbar-width)',
          marginRight: store.player.currSong ? 'var(--audio-sidebar-width)' : '0',
        }}
      >
        <AudioSidebar />
        <div class="w-full flex flex-col flex-1">
          <Slot />
        </div>
        <Footer />
      </main>
    </>
  )
})

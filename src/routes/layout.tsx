import {
  component$,
  createContextId,
  Slot,
  useContextProvider,
  useStore,
  useTask$,
  useVisibleTask$,
} from '@builder.io/qwik'
import type { Store, StoreActions } from '~/App'
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts'
import Nav from '~/components/nav'
import Footer from '~/components/footer'
import AudioSidebar from '~/components/audio-sidebar'
import { StorageStore } from '~/hooks/useStoragePage'
import { ArtistPageState } from '~/hooks/useArtistPage'
import { LibraryStore } from '~/hooks/useLibraryPage'
import { AudioPlayerState, useAudioPlayer } from '~/hooks/useAudioPlayer'

export const StoreContext = createContextId<Store>('docs.store-context')
export const StoreActionsContext = createContextId<StoreActions>('docs.store-actions-context')

export default component$(() => {
  const store = useStore<Store>(
    {
      audioDir: '',
      allSongs: [],
      filteredSongs: [],
      playlist: [],
      queue: [],
      sorting: 'default',
      searchTerm: '',
      ...LibraryStore,
      ...ArtistPageState,
      ...StorageStore,
      ...AudioPlayerState,
      isTyping: false,
      showKeyShortcuts: false,
    },
    { deep: true }
  )
  useContextProvider(StoreContext, store)

  const audioActions = useAudioPlayer(store)

  // Provide audio controls to the app
  useContextProvider(StoreActionsContext, audioActions)

  // Listen for Keyboard Shortcuts
  useKeyboardShortcuts(store, audioActions)

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
        if (audioElem.ended && !store.player.isPaused) audioActions.nextSong()
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

    store.filteredSongs.sort((song1, song2) => {
      switch (sorting) {
        case 'title-desc':
          return song1.title.localeCompare(song2.title)
        case 'title-asc':
          return song2.title.localeCompare(song1.title)
        case 'artist-desc':
          return song1.artist.localeCompare(song2.artist)
        case 'artist-asc':
          // First, compare the artists
          if (song2.artist < song1.artist) return -1
          else if (song2.artist > song1.artist) return 1
          // If the artists are the same, compare the track numbers
          if (song2.trackNumber < song1.trackNumber) return -1
          else if (song2.trackNumber > song1.trackNumber) return 1
          // If both artist and track number are the same, preserve the original order
          return 0
        case 'album-desc':
          // First, compare the artists
          if (song1.artist < song2.artist) return -1
          else if (song1.artist > song2.artist) return 1
          // If the artists are the same, compare the track numbers
          if (song1.trackNumber < song2.trackNumber) return -1
          else if (song1.trackNumber > song2.trackNumber) return 1
          // If both artist and track number are the same, preserve the original order
          return 0
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

    store.filteredSongs = searchTerm
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

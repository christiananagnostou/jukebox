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
import { loadLibrarySongs } from '~/services/library-db'
import { compareSongsByAlbumTrack } from '~/utils/Songs'
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts'
import Nav from '~/components/nav'
import Footer from '~/components/footer'
import AudioSidebar from '~/components/audio-sidebar'
import { StorageStore } from '~/hooks/useStoragePage'
import { ArtistPageState } from '~/hooks/useArtistPage'
import { LibraryStore } from '~/hooks/useLibraryPage'
import { AudioPlayerState, useAudioPlayer } from '~/hooks/useAudioPlayer'

export const StoreContext = createContextId<Store>('store-context')
export const StoreActionsContext = createContextId<StoreActions>('store-actions-context')

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
  const storeActions: StoreActions = audioActions
  useContextProvider(StoreActionsContext, storeActions)

  useKeyboardShortcuts(store, storeActions)

  /**
   *
   * Runs as soon as the window is visible
   *
   */
  useVisibleTask$(async () => {
    store.allSongs = (await loadLibrarySongs()).sort(compareSongsByAlbumTrack)
  })

  /**
   *
   * Song Sorting
   *
   */
  useTask$(({ track }) => {
    const sorting = track(() => store.sorting)
    track(() => store.searchTerm)

    /**
     *
     * TODO:
     * Reproduce: search a term -> init any sort -> exit searching
     * Result: list is not sorted anymore and ascending can happen before descending
     *
     */
    store.filteredSongs.sort((song1, song2) => {
      switch (sorting) {
        case 'artist-desc':
          // First, compare the artists
          if (song1.artist < song2.artist) return -1
          else if (song1.artist > song2.artist) return 1
          // If the artists are the same, compare the albums
          if (song1.album < song2.album) return -1
          else if (song1.album > song2.album) return 1
          // If the albums are the same, compare the track numbers
          if (song1.trackNumber < song2.trackNumber) return -1
          else if (song1.trackNumber > song2.trackNumber) return 1
          // If both artist and track number are the same, preserve the original order
          return 0

        case 'album-desc':
        case 'track-desc':
          // First, compare the albums
          if (song1.album < song2.album) return -1
          else if (song1.album > song2.album) return 1
          // If the albums are the same, compare the track numbers
          if (song1.trackNumber < song2.trackNumber) return -1
          else if (song1.trackNumber > song2.trackNumber) return 1
          // If both artist and track number are the same, preserve the original order
          return 0

        case 'track-asc':
          // First, compare the albums
          if (song1.album < song2.album) return -1
          else if (song1.album > song2.album) return 1
          // If the albums are the same, compare the track numbers
          if (song1.trackNumber > song2.trackNumber) return -1
          else if (song1.trackNumber < song2.trackNumber) return 1
          // If both artist and track number are the same, preserve the original order
          return 0

        case 'artist-asc':
          // Ascending doesn't need complex sort because it always happens after a descending sort
          return song2.artist.localeCompare(song1.artist)
        case 'album-asc':
          // Ascending doesn't need complex sort because it always happens after a descending sort
          return song2.album.localeCompare(song1.album)

        case 'title-desc':
          return song1.title.localeCompare(song2.title)
        case 'title-asc':
          return song2.title.localeCompare(song1.title)

        case 'hertz-desc':
          return parseInt(song1.sampleRate) - parseInt(song2.sampleRate)
        case 'hertz-asc':
          return parseInt(song2.sampleRate) - parseInt(song1.sampleRate)

        case 'date-desc':
          return parseInt(song1.date || '0') - parseInt(song2.date || '0')
        case 'date-asc':
          return parseInt(song2.date || '0') - parseInt(song1.date || '0')

        case 'fave-desc':
          return song1.favorRating - song2.favorRating
        case 'fave-asc':
          return song2.favorRating - song1.favorRating

        case 'date-added-desc':
          return new Date(song1.dateAdded).getTime() - new Date(song2.dateAdded).getTime()
        case 'date-added-asc':
          return new Date(song2.dateAdded).getTime() - new Date(song1.dateAdded).getTime()

        default:
          return 1
      }
    })
  })

  /**
   *
   * Search Filtering
   *
   */
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

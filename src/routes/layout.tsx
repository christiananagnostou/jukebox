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
import { filterAndSortSongs } from '~/utils/Songs'
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

  useVisibleTask$(async () => {
    store.allSongs = await loadLibrarySongs()
  })

  useTask$(({ track }) => {
    const allSongs = track(() => store.allSongs)
    const sorting = track(() => store.sorting)
    const searchTerm = track(() => store.searchTerm)

    store.filteredSongs = filterAndSortSongs(allSongs, searchTerm, sorting)
  })

  return (
    <>
      <Nav />

      <main
        class="h-screen max-h-screen w-full flex flex-col relative"
        style={{
          marginLeft: 'var(--navbar-width)',
          marginRight: store.player.currSong ? 'var(--audio-sidebar-width)' : '0',
        }}
      >
        <AudioSidebar />
        <div class="min-h-0 w-full flex flex-col flex-1">
          <Slot />
        </div>
        <Footer />
      </main>
    </>
  )
})

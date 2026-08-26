import {
  component$,
  createContextId,
  Slot,
  useContextProvider,
  useStore,
  useTask$,
  useVisibleTask$,
} from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'
import { audioDir } from '@tauri-apps/api/path'

import type { SettingsSnapshot, Store, StoreActions } from '~/App'
import { loadLibrarySongs } from '~/services/library-db'
import {
  applyLibraryBootstrap,
  applySettingsBootstrap,
  SETTINGS_SAVE_ERROR_MESSAGE,
  settleBootstrap,
} from '~/services/bootstrap'
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
      allSongs: [],
      filteredSongs: [],
      playlist: [],
      queue: [],
      sorting: 'default',
      searchTerm: '',
      settings: {
        closeOnX: false,
        musicFolder: '',
        remoteAccessEnabled: false,
      },
      bootstrap: {
        libraryStatus: 'loading',
        libraryError: '',
        settingsWarning: '',
      },
      sync: {
        status: 'idle',
        processed: 0,
        total: 0,
        lastRunAt: '',
        message: '',
      },
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
    const result = await settleBootstrap(loadLibrarySongs, () => invoke<SettingsSnapshot>('get_settings'))

    store.allSongs = result.library.songs
    applyLibraryBootstrap(store.bootstrap, result.library)
    store.settings = result.settings.settings
    applySettingsBootstrap(store.bootstrap, result.settings)

    if (!result.settings.warning && !store.settings.musicFolder) {
      const musicFolder = await audioDir().catch(() => '')
      if (musicFolder) {
        try {
          const snapshot = await invoke<SettingsSnapshot>('set_settings', {
            settings: { ...store.settings, musicFolder },
          })
          store.settings = snapshot.settings
          store.bootstrap.settingsWarning = snapshot.warning?.message || ''
        } catch {
          store.bootstrap.settingsWarning = SETTINGS_SAVE_ERROR_MESSAGE
        }
      }
    }
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

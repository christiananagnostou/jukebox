import { component$, createContextId, Slot, useContextProvider, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'
import { audioDir } from '@tauri-apps/api/path'

import type { SettingsSnapshot, Store, StoreActions } from '~/App'
import {
  applySettingsBootstrap,
  DEFAULT_SETTINGS,
  SETTINGS_BOOTSTRAP_ERROR_MESSAGE,
  SETTINGS_SAVE_ERROR_MESSAGE,
} from '~/services/bootstrap'
import { useKeyboardShortcuts } from '~/hooks/useKeyboardShortcuts'
import Nav from '~/components/nav'
import Footer from '~/components/footer'
import AudioSidebar from '~/components/audio-sidebar'
import { StorageStore } from '~/hooks/useStoragePage'
import { ArtistPageState } from '~/hooks/useArtistPage'
import { LibraryStore } from '~/hooks/useLibraryPage'
import { AudioPlayerState, useAudioPlayer } from '~/hooks/useAudioPlayer'
import { useLibraryCatalog } from '~/services/library-client'
import { addLibraryRoot, listLibraryRoots, useLibraryRefreshEvents } from '~/services/library-refresh'

export const StoreContext = createContextId<Store>('store-context')
export const StoreActionsContext = createContextId<StoreActions>('store-actions-context')

export default component$(() => {
  const store = useStore<Store>(
    {
      libraryCatalog: {
        error: '',
        loadedSongCount: 0,
        pages: {},
        refreshKey: 0,
        revision: 0,
        status: 'loading',
        total: 0,
      },
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
  const libraryActions = useLibraryCatalog(store)
  const storeActions: StoreActions = { ...audioActions, ...libraryActions }
  useContextProvider(StoreActionsContext, storeActions)

  useKeyboardShortcuts(store, storeActions)
  useLibraryRefreshEvents(store)

  useVisibleTask$(async () => {
    try {
      const snapshot = await invoke<SettingsSnapshot>('get_settings')
      store.settings = snapshot.settings
      applySettingsBootstrap(store.bootstrap, {
        settings: snapshot.settings,
        warning: snapshot.warning?.message || '',
      })
    } catch {
      store.settings = { ...DEFAULT_SETTINGS }
      store.bootstrap.settingsWarning = SETTINGS_BOOTSTRAP_ERROR_MESSAGE
    }

    if (!store.bootstrap.settingsWarning && !store.settings.musicFolder) {
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

    if (!store.bootstrap.settingsWarning && store.settings.musicFolder) {
      try {
        const roots = await listLibraryRoots()
        if (!roots.length) await addLibraryRoot(store.settings.musicFolder)
      } catch {
        store.sync.status = 'error'
        store.sync.message = 'The saved music folder could not be registered.'
      }
    }
  })

  return (
    <div
      class="app-shell"
      data-player-open={store.player.currSong || store.queue.length || store.player.canUndoQueueEdit ? 'true' : 'false'}
    >
      <Nav />

      <main class="app-main h-screen max-h-screen min-w-0 flex flex-col relative">
        <div class="min-h-0 w-full flex flex-col flex-1">
          <Slot />
        </div>
        <Footer />
      </main>

      <AudioSidebar />
    </div>
  )
})

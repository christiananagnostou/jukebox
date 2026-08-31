import { $, component$, useComputed$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { Link, type DocumentHead } from '@builder.io/qwik-city'
import { listen } from '@tauri-apps/api/event'
import { audioDir } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'

import type { Settings, SettingsSnapshot } from '~/App'
import { SettingsShell } from '~/components/settings/SettingsShell'
import { pickMusicFolders } from '~/services/dialog-client'
import { clearLibrarySongs } from '~/services/library-db'
import {
  addLibraryRoot,
  cancelLibraryRefresh,
  isLibraryRefreshActive,
  LIBRARY_REFRESH_EVENT,
  libraryRefreshProgress,
  listLibraryRefreshes,
  listLibraryRoots,
  setLibraryRootEnabled,
  startLibraryRefresh,
  watcherStatusLabel,
  type LibraryRefresh,
  type LibraryRoot,
} from '~/services/library-refresh'
import { getErrorMessage } from '~/utils/Errors'
import { StoreActionsContext, StoreContext } from '../../layout'

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const state = useStore({
    confirmClear: false,
    error: '',
    refreshes: {} as Record<string, LibraryRefresh>,
    roots: [] as LibraryRoot[],
  })
  const isBusy = useComputed$(() => store.sync.status === 'scanning' || store.sync.status === 'importing')

  useVisibleTask$(({ cleanup }) => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const loadState = async () => {
      try {
        const [roots, refreshes] = await Promise.all([listLibraryRoots(), listLibraryRefreshes()])
        if (disposed) return
        state.roots = roots
        state.refreshes = Object.fromEntries(refreshes.map((refresh) => [String(refresh.scan.rootId), refresh]))
      } catch (error) {
        if (!disposed) state.error = getErrorMessage(error)
      }
    }

    void listen<LibraryRefresh>(LIBRARY_REFRESH_EVENT, ({ payload }) => {
      if (disposed) return
      state.refreshes[String(payload.scan.rootId)] = payload
      if (!isLibraryRefreshActive(payload)) void listLibraryRoots().then((roots) => (state.roots = roots))
    })
      .then((stop) => {
        if (disposed) return stop()
        unlisten = stop
        void loadState()
      })
      .catch(() => void loadState())

    cleanup(() => {
      disposed = true
      unlisten?.()
    })
  })

  const saveSettings = $(async (settings: Settings): Promise<boolean> => {
    try {
      const snapshot = await invoke<SettingsSnapshot>('set_settings', { settings })
      store.settings = snapshot.settings
      store.bootstrap.settingsWarning = snapshot.warning?.message || ''
      return true
    } catch (error) {
      state.error = getErrorMessage(error)
      return false
    }
  })

  const registerFolder = $(async (path: string) => {
    if (!(await saveSettings({ ...store.settings, musicFolder: path }))) return
    const root = await addLibraryRoot(path)
    state.roots = [...state.roots.filter((item) => item.id !== root.id), root]
    state.error = ''
  })

  const chooseMusicFolder = $(async () => {
    try {
      const [selected] = await pickMusicFolders({
        multiple: false,
        defaultPath: store.settings.musicFolder || undefined,
      })
      if (selected) await registerFolder(selected)
    } catch (error) {
      state.error = getErrorMessage(error)
    }
  })

  const restoreDefaultFolder = $(async () => {
    try {
      await registerFolder(await audioDir())
    } catch (error) {
      state.error = getErrorMessage(error)
    }
  })

  const refreshRoot = $(async (rootId: number) => {
    try {
      const refresh = await startLibraryRefresh(rootId)
      state.refreshes[String(rootId)] = refresh
      state.error = ''
    } catch (error) {
      state.error = getErrorMessage(error)
    }
  })

  const cancelRefresh = $(async (scanId: number) => {
    try {
      const refresh = await cancelLibraryRefresh(scanId)
      state.refreshes[String(refresh.scan.rootId)] = refresh
      state.error = ''
    } catch (error) {
      state.error = getErrorMessage(error)
    }
  })

  const toggleRoot = $(async (root: LibraryRoot) => {
    try {
      const updated = await setLibraryRootEnabled(root.id, !root.enabled)
      state.roots = state.roots.map((item) => (item.id === updated.id ? updated : item))
      state.error = ''
    } catch (error) {
      state.error = getErrorMessage(error)
    }
  })

  const clearLibrary = $(async () => {
    store.sync.status = 'scanning'
    store.sync.processed = 0
    store.sync.total = 0
    store.sync.message = 'Clearing library'

    try {
      const disabled = await Promise.all(
        state.roots.filter((root) => root.enabled).map((root) => setLibraryRootEnabled(root.id, false))
      )
      const disabledById = new Map(disabled.map((root) => [root.id, root]))
      state.roots = state.roots.map((root) => disabledById.get(root.id) || root)
      await clearLibrarySongs()
      await storeActions.clearPlayback()
      store.libraryCatalog.pages = {}
      store.libraryCatalog.total = 0
      store.libraryCatalog.loadedSongCount = 0
      store.libraryCatalog.refreshKey += 1
      store.libraryView.cursorIdx = 0
      store.storageView.nodes = { error: '', pages: {}, revision: 0, status: 'ready', total: 0 }
      store.storageView.parent = ''
      store.storageView.rootDisplayPath = ''
      store.storageView.rootId = null
      store.storageView.rootName = ''
      store.sync.status = 'idle'
      store.sync.message = ''
      state.confirmClear = false
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
    }
  })

  return (
    <SettingsShell
      current="library"
      title="Library settings"
      description="Control the folders Jukebox watches and the local catalog built from them."
    >
      <section class="settings-control-group" aria-labelledby="music-folders-heading">
        <header class="settings-group-header">
          <div>
            <h2 id="music-folders-heading">Music folders</h2>
            <p>Enabled folders are indexed natively and watched for changes.</p>
          </div>
          <Link class="workspace-link" href="/import/">
            Import music
          </Link>
        </header>

        <div class="settings-action-row">
          <button class="workspace-primary-action" type="button" onClick$={chooseMusicFolder} disabled={isBusy.value}>
            Add folder
          </button>
          <button
            class="workspace-secondary-action"
            type="button"
            onClick$={restoreDefaultFolder}
            disabled={isBusy.value}
          >
            Add system music folder
          </button>
        </div>

        {state.error && (
          <p class="settings-message" data-tone="error" role="alert">
            {state.error}
          </p>
        )}

        {state.roots.length ? (
          <ul class="settings-root-list" aria-label="Music folders">
            {state.roots.map((root) => {
              const refresh = state.refreshes[String(root.id)]
              const active = isLibraryRefreshActive(refresh)
              const progress = refresh && libraryRefreshProgress(refresh)
              const errorSummary = refresh?.reconciliation?.errorSummary || refresh?.scan.errorSummary

              return (
                <li key={root.id}>
                  <div class="settings-root-main">
                    <div>
                      <p class="settings-root-path" title={root.path}>
                        {root.path}
                      </p>
                      <p class="settings-root-state">
                        {root.enabled ? watcherStatusLabel(root.watchStatus) : 'Disabled'}
                        {refresh ? ` · ${refresh.status.replaceAll('_', ' ')}` : ''}
                      </p>
                    </div>
                    <div class="settings-action-row">
                      {active && refresh ? (
                        <button
                          class="workspace-secondary-action"
                          type="button"
                          aria-label={`Cancel refresh for ${root.path}`}
                          onClick$={() => cancelRefresh(refresh.scan.id)}
                        >
                          Cancel refresh
                        </button>
                      ) : (
                        <button
                          class="workspace-secondary-action"
                          type="button"
                          aria-label={`Refresh ${root.path}`}
                          disabled={!root.enabled || isBusy.value}
                          onClick$={() => refreshRoot(root.id)}
                        >
                          Refresh
                        </button>
                      )}
                      <button
                        class="workspace-secondary-action"
                        type="button"
                        aria-label={`${root.enabled ? 'Disable' : 'Enable'} ${root.path}`}
                        disabled={active}
                        onClick$={() => toggleRoot(root)}
                      >
                        {root.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                  {active && progress && (
                    <progress
                      class="settings-progress"
                      value={progress.total ? progress.processed : undefined}
                      max={progress.total || undefined}
                    >
                      {progress.total ? `${progress.processed}/${progress.total}` : 'Scanning'}
                    </progress>
                  )}
                  {errorSummary && (
                    <p class="settings-message" data-tone="error">
                      {errorSummary}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p class="settings-empty">No music folders are registered yet.</p>
        )}
      </section>

      <section class="settings-control-group settings-danger-zone" aria-labelledby="clear-library-heading">
        <header>
          <h2 id="clear-library-heading">Clear library</h2>
          <p>Disable every folder and remove indexed tracks. Your music files are never deleted.</p>
        </header>

        {isBusy.value && <progress class="settings-progress">Working</progress>}
        <div class="settings-action-row">
          {state.confirmClear ? (
            <>
              <button class="settings-danger-action" type="button" onClick$={clearLibrary} disabled={isBusy.value}>
                Disable folders and clear library
              </button>
              <button class="workspace-secondary-action" type="button" onClick$={() => (state.confirmClear = false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              class="settings-danger-action"
              type="button"
              onClick$={() => (state.confirmClear = true)}
              disabled={isBusy.value}
            >
              Clear library…
            </button>
          )}
        </div>
      </section>
    </SettingsShell>
  )
})

export const head: DocumentHead = {
  title: 'Library settings · Jukebox',
  meta: [{ name: 'description', content: 'Manage Jukebox music folders and the local catalog.' }],
}

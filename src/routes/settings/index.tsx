import { $, component$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { audioDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'

import type { RemoteAccessStatus, Settings, SettingsSnapshot, TailscaleStatus } from '~/App'
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
import { StoreActionsContext, StoreContext } from '../layout'

const SECTION_CLASS = 'border-b border-gray-700 pb-6 flex flex-col gap-3'
const BUTTON_CLASS = 'w-fit border border-gray-600 px-3 py-2 text-sm hover:border-gray-400 disabled:opacity-50'
export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const state = useStore({
    confirmAction: '' as '' | 'clear',
    diagnosticsAction: '' as '' | 'copy' | 'open',
    diagnosticsError: '',
    diagnosticsMessage: '',
    libraryError: '',
    refreshes: {} as Record<string, LibraryRefresh>,
    roots: [] as LibraryRoot[],
    remoteAccessBusy: false,
    tailscaleAction: '' as '' | 'refresh' | 'start' | 'stop',
    tailscaleActionError: '',
    remoteAccess: {
      enabled: false,
      port: 45321,
      running: false,
      url: 'http://127.0.0.1:45321',
    } as RemoteAccessStatus,
    tailscale: {
      connected: false,
      installed: false,
      serveConfigured: false,
      serveManaged: false,
    } as TailscaleStatus,
  })
  const isBusy = store.sync.status === 'scanning' || store.sync.status === 'importing'

  useVisibleTask$(({ cleanup }) => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const loadState = async () => {
      try {
        const [remoteAccess, tailscale, roots, refreshes] = await Promise.all([
          invoke<RemoteAccessStatus>('get_remote_access_status').catch(() => ({
            enabled: store.settings.remoteAccessEnabled,
            error: 'Remote access status is unavailable',
            port: 45321,
            running: false,
            url: 'http://127.0.0.1:45321',
          })),
          invoke<TailscaleStatus>('get_tailscale_status').catch(() => ({
            connected: false,
            error: 'Tailscale status is unavailable',
            installed: false,
            serveConfigured: false,
            serveManaged: false,
          })),
          listLibraryRoots(),
          listLibraryRefreshes(),
        ])
        if (disposed) return
        state.remoteAccess = remoteAccess
        state.tailscale = tailscale
        state.roots = roots
        state.refreshes = {
          ...Object.fromEntries(refreshes.map((refresh) => [String(refresh.scan.rootId), refresh])),
          ...state.refreshes,
        }
      } catch (error) {
        if (!disposed) state.libraryError = getErrorMessage(error)
      }
    }

    void listen<LibraryRefresh>(LIBRARY_REFRESH_EVENT, ({ payload }) => {
      if (disposed) return
      state.refreshes[String(payload.scan.rootId)] = payload
      if (!isLibraryRefreshActive(payload)) void listLibraryRoots().then((roots) => (state.roots = roots))
    })
      .then((stop) => {
        if (disposed) {
          stop()
          return
        }
        unlisten = stop
        void loadState()
      })
      .catch(() => {
        void loadState()
      })
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
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
      return false
    }
  })

  const chooseMusicFolder = $(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: store.settings.musicFolder || undefined,
    })

    if (selected && !Array.isArray(selected)) {
      try {
        if (!(await saveSettings({ ...store.settings, musicFolder: selected }))) return
        const root = await addLibraryRoot(selected)
        state.roots = [...state.roots.filter((item) => item.id !== root.id), root]
        state.libraryError = ''
      } catch (error) {
        state.libraryError = getErrorMessage(error)
      }
    }
  })

  const restoreDefaultFolder = $(async () => {
    try {
      const musicFolder = await audioDir()
      if (!(await saveSettings({ ...store.settings, musicFolder }))) return
      const root = await addLibraryRoot(musicFolder)
      state.roots = [...state.roots.filter((item) => item.id !== root.id), root]
      state.libraryError = ''
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
    }
  })

  const refreshRoot = $(async (rootId: number) => {
    try {
      const refresh = await startLibraryRefresh(rootId)
      state.refreshes[String(rootId)] = refresh
      state.libraryError = ''
    } catch (error) {
      state.libraryError = getErrorMessage(error)
    }
  })

  const cancelRefresh = $(async (scanId: number) => {
    try {
      const refresh = await cancelLibraryRefresh(scanId)
      state.refreshes[String(refresh.scan.rootId)] = refresh
      state.libraryError = ''
    } catch (error) {
      state.libraryError = getErrorMessage(error)
    }
  })

  const toggleRoot = $(async (root: LibraryRoot) => {
    try {
      const updated = await setLibraryRootEnabled(root.id, !root.enabled)
      state.roots = state.roots.map((item) => (item.id === updated.id ? updated : item))
      state.libraryError = ''
    } catch (error) {
      state.libraryError = getErrorMessage(error)
    }
  })

  const toggleRemoteAccess = $(async () => {
    if (state.remoteAccessBusy) return
    state.remoteAccessBusy = true
    try {
      state.remoteAccess = await invoke<RemoteAccessStatus>('set_remote_access_enabled', {
        enabled: !state.remoteAccess.enabled,
      })
      store.settings.remoteAccessEnabled = state.remoteAccess.enabled
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
    } finally {
      state.remoteAccessBusy = false
    }
  })

  const refreshTailscale = $(async () => {
    if (state.tailscaleAction) return
    state.tailscaleAction = 'refresh'
    state.tailscaleActionError = ''
    try {
      state.tailscale = await invoke<TailscaleStatus>('get_tailscale_status')
    } catch (error) {
      state.tailscaleActionError = getErrorMessage(error)
    } finally {
      state.tailscaleAction = ''
    }
  })

  const startTailscale = $(async () => {
    if (state.tailscaleAction) return
    state.tailscaleAction = 'start'
    state.tailscaleActionError = ''
    try {
      state.tailscale = await invoke<TailscaleStatus>('start_tailscale_serve')
    } catch (error) {
      state.tailscaleActionError = getErrorMessage(error)
    } finally {
      state.tailscaleAction = ''
    }
  })

  const stopTailscale = $(async () => {
    if (state.tailscaleAction) return
    state.tailscaleAction = 'stop'
    state.tailscaleActionError = ''
    try {
      state.tailscale = await invoke<TailscaleStatus>('stop_tailscale_serve')
    } catch (error) {
      state.tailscaleActionError = getErrorMessage(error)
    } finally {
      state.tailscaleAction = ''
    }
  })

  const copyDiagnostics = $(async () => {
    if (state.diagnosticsAction) return
    state.diagnosticsAction = 'copy'
    state.diagnosticsError = ''
    state.diagnosticsMessage = ''
    try {
      await invoke('copy_diagnostics_summary')
      state.diagnosticsMessage = 'Diagnostics summary copied.'
    } catch (error) {
      state.diagnosticsError = getErrorMessage(error)
    } finally {
      state.diagnosticsAction = ''
    }
  })

  const openDiagnostics = $(async () => {
    if (state.diagnosticsAction) return
    state.diagnosticsAction = 'open'
    state.diagnosticsError = ''
    state.diagnosticsMessage = ''
    try {
      await invoke('open_diagnostics_directory')
      state.diagnosticsMessage = 'Diagnostics folder opened.'
    } catch (error) {
      state.diagnosticsError = getErrorMessage(error)
    } finally {
      state.diagnosticsAction = ''
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
      state.confirmAction = ''
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
    }
  })

  return (
    <section class="min-h-0 flex-1 overflow-y-auto p-6">
      <div class="mx-auto flex max-w-3xl flex-col gap-6">
        <header>
          <h1 class="text-xl">Settings</h1>
          <p class="mt-1 text-sm text-gray-400">Playback behavior and library maintenance.</p>
        </header>

        <div class={SECTION_CLASS}>
          <div class="flex items-center justify-between gap-6">
            <div>
              <h2 class="text-sm font-medium">Listen from another device</h2>
              <p class="mt-1 text-xs text-gray-400">
                Runs a private player on this computer. It only accepts local connections until you securely proxy it.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={state.remoteAccess.enabled}
              aria-busy={state.remoteAccessBusy}
              disabled={state.remoteAccessBusy}
              class={`h-6 w-11 border ${state.remoteAccess.enabled ? 'border-emerald-400 bg-emerald-700' : 'border-gray-600 bg-gray-800'}`}
              onClick$={toggleRemoteAccess}
            >
              <span class="sr-only">Listen from another device</span>
              {state.remoteAccess.enabled ? 'On' : 'Off'}
            </button>
          </div>
          {state.remoteAccess.enabled && (
            <div class="flex flex-col gap-3 text-xs text-gray-400">
              <p>
                {state.remoteAccess.running ? `Local server ready at ${state.remoteAccess.url}` : 'Starting server…'}
              </p>
              {state.remoteAccess.error && <p class="text-red-300">{state.remoteAccess.error}</p>}
              <div class="border border-gray-700 bg-gray-900 p-4">
                <div class="flex flex-wrap items-center gap-2 text-gray-300" aria-label="Private listening route">
                  <span
                    class={`h-2 w-2 rounded-full ${state.remoteAccess.running ? 'bg-emerald-400' : 'bg-gray-600'}`}
                    aria-hidden="true"
                  />
                  <span>Computer</span>
                  <span aria-hidden="true">→</span>
                  <span
                    class={`h-2 w-2 rounded-full ${state.tailscale.serveConfigured ? 'bg-emerald-400' : 'bg-gray-600'}`}
                    aria-hidden="true"
                  />
                  <span>Private HTTPS</span>
                  <span aria-hidden="true">→</span>
                  <span>Phone</span>
                </div>
                {!state.tailscale.installed ? (
                  <p class="mt-3">
                    Install Tailscale on this computer and your phone, then sign both into the same tailnet.
                  </p>
                ) : state.tailscale.serveConfigured ? (
                  <div class="mt-3 flex flex-col gap-2">
                    <p class="font-medium text-emerald-300">Private access is running</p>
                    {state.tailscale.url && (
                      <code class="overflow-x-auto border border-gray-700 bg-black px-2 py-2 text-gray-200">
                        {state.tailscale.url}
                      </code>
                    )}
                    <p>
                      Jukebox has its own private HTTPS address. Open the address in Safari, then use Share → Add to
                      Home Screen.
                    </p>
                    {state.tailscale.serveManaged ? (
                      <button class={BUTTON_CLASS} disabled={Boolean(state.tailscaleAction)} onClick$={stopTailscale}>
                        {state.tailscaleAction === 'stop' ? 'Stopping…' : 'Stop Jukebox on Tailscale'}
                      </button>
                    ) : (
                      <p class="text-amber-300">
                        This endpoint is shared with another app, so Jukebox will not remove it automatically.
                      </p>
                    )}
                  </div>
                ) : state.tailscale.connected ? (
                  <div class="mt-3 flex flex-col gap-2">
                    {state.tailscale.error ? (
                      <p class="text-red-300">{state.tailscale.error}</p>
                    ) : state.tailscale.recommendedHttpsPort ? (
                      <>
                        <p>
                          Jukebox will use a dedicated HTTPS port ({state.tailscale.recommendedHttpsPort}) without
                          changing existing routes.
                        </p>
                        <button
                          class={BUTTON_CLASS}
                          disabled={Boolean(state.tailscaleAction) || !state.remoteAccess.running}
                          onClick$={startTailscale}
                        >
                          {state.tailscaleAction === 'start' ? 'Starting…' : 'Start Jukebox on Tailscale'}
                        </button>
                      </>
                    ) : (
                      <p class="text-amber-300">
                        Jukebox could not find a free private HTTPS port. Stop an unused Tailscale Serve endpoint, then
                        check again.
                      </p>
                    )}
                  </div>
                ) : (
                  <div class="mt-3">
                    <p>Open Tailscale and sign in before configuring private HTTPS.</p>
                    {state.tailscale.backendState && <p class="mt-1">State: {state.tailscale.backendState}</p>}
                    {state.tailscale.error && <p class="mt-1 text-red-300">{state.tailscale.error}</p>}
                  </div>
                )}
                {state.tailscaleActionError && <p class="mt-3 text-red-300">{state.tailscaleActionError}</p>}
                <div class="mt-3 flex flex-wrap items-center gap-3">
                  <button class={BUTTON_CLASS} disabled={Boolean(state.tailscaleAction)} onClick$={refreshTailscale}>
                    {state.tailscaleAction === 'refresh' ? 'Checking…' : 'Check again'}
                  </button>
                  <span>Uses Tailscale Serve only. Public Funnel is not supported.</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div class={SECTION_CLASS}>
          <div class="flex items-center justify-between gap-6">
            <div>
              <h2 class="text-sm font-medium">Close app when the window closes</h2>
              <p class="mt-1 text-xs text-gray-400">When disabled, Jukebox keeps playing in the system tray.</p>
            </div>
            <button
              role="switch"
              aria-checked={store.settings.closeOnX}
              class={`h-6 w-11 border ${store.settings.closeOnX ? 'border-emerald-400 bg-emerald-700' : 'border-gray-600 bg-gray-800'}`}
              onClick$={() => saveSettings({ ...store.settings, closeOnX: !store.settings.closeOnX })}
            >
              <span class="sr-only">Close app when the window closes</span>
              {store.settings.closeOnX ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        <div class={SECTION_CLASS}>
          <div>
            <h2 class="text-sm font-medium">Music folders</h2>
            <p class="mt-1 text-xs text-gray-400">
              Jukebox indexes enabled folders natively and watches them for changes.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class={BUTTON_CLASS} onClick$={chooseMusicFolder} disabled={isBusy}>
              Add folder
            </button>
            <button class={BUTTON_CLASS} onClick$={restoreDefaultFolder} disabled={isBusy}>
              Add system music folder
            </button>
          </div>
          {state.libraryError && <p class="text-xs text-red-300">{state.libraryError}</p>}
          {state.roots.length ? (
            <ul class="flex flex-col gap-2" aria-label="Music folders">
              {state.roots.map((root) => {
                const refresh = state.refreshes[String(root.id)]
                const active = isLibraryRefreshActive(refresh)
                const progress = refresh && libraryRefreshProgress(refresh)
                return (
                  <li key={root.id} class="border border-gray-700 bg-gray-900 p-3">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm text-gray-200" title={root.path}>
                          {root.path}
                        </p>
                        <p class="mt-1 text-xs text-gray-400">
                          {root.enabled ? watcherStatusLabel(root.watchStatus) : 'Disabled'}
                          {refresh ? ` · ${refresh.status.replaceAll('_', ' ')}` : ''}
                        </p>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        {active && refresh ? (
                          <button
                            class={BUTTON_CLASS}
                            aria-label={`Cancel refresh for ${root.path}`}
                            onClick$={() => cancelRefresh(refresh.scan.id)}
                          >
                            Cancel refresh
                          </button>
                        ) : (
                          <button
                            class={BUTTON_CLASS}
                            aria-label={`Refresh ${root.path}`}
                            disabled={!root.enabled || isBusy}
                            onClick$={() => refreshRoot(root.id)}
                          >
                            Refresh
                          </button>
                        )}
                        <button
                          class={BUTTON_CLASS}
                          aria-label={`${root.enabled ? 'Disable' : 'Enable'} ${root.path}`}
                          disabled={active}
                          onClick$={() => toggleRoot(root)}
                        >
                          {root.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </div>
                    {active &&
                      progress &&
                      (progress.total ? (
                        <progress class="mt-3 h-2 w-full" value={progress.processed} max={progress.total}>
                          {progress.processed}/{progress.total}
                        </progress>
                      ) : (
                        <progress class="mt-3 h-2 w-full">Scanning</progress>
                      ))}
                    {refresh?.reconciliation?.errorSummary && (
                      <p class="mt-2 text-xs text-red-300">{refresh.reconciliation.errorSummary}</p>
                    )}
                    {!refresh?.reconciliation && refresh?.scan.errorSummary && (
                      <p class="mt-2 text-xs text-red-300">{refresh.scan.errorSummary}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p class="text-xs text-gray-500">No music folders registered.</p>
          )}
        </div>

        <div class={SECTION_CLASS}>
          <div>
            <h2 class="text-sm font-medium">Diagnostics</h2>
            <p class="mt-1 text-xs text-gray-400">
              Jukebox keeps bounded local logs with categorized errors. Music paths, filenames, device names, and
              private network addresses are excluded.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class={BUTTON_CLASS} disabled={Boolean(state.diagnosticsAction)} onClick$={copyDiagnostics}>
              {state.diagnosticsAction === 'copy' ? 'Copying…' : 'Copy diagnostics summary'}
            </button>
            <button class={BUTTON_CLASS} disabled={Boolean(state.diagnosticsAction)} onClick$={openDiagnostics}>
              {state.diagnosticsAction === 'open' ? 'Opening…' : 'Open diagnostics folder'}
            </button>
          </div>
          {state.diagnosticsMessage && <p class="text-xs text-emerald-300">{state.diagnosticsMessage}</p>}
          {state.diagnosticsError && <p class="text-xs text-red-300">{state.diagnosticsError}</p>}
        </div>

        <div class={SECTION_CLASS}>
          <div>
            <h2 class="text-sm font-medium">Library cleanup</h2>
            <p class="mt-1 text-xs text-gray-400">
              Missing tracks become unavailable after a successful refresh and return automatically when found again.
            </p>
          </div>

          {isBusy &&
            (store.sync.total ? (
              <progress class="h-2 w-full" value={store.sync.processed} max={store.sync.total}>
                {store.sync.processed}/{store.sync.total}
              </progress>
            ) : (
              <progress class="h-2 w-full">Working</progress>
            ))}
          <div class="flex flex-wrap gap-2">
            {state.confirmAction === 'clear' ? (
              <>
                <button class={`${BUTTON_CLASS} border-red-700 text-red-300`} onClick$={clearLibrary} disabled={isBusy}>
                  Disable folders and clear library
                </button>
                <button class={BUTTON_CLASS} onClick$={() => (state.confirmAction = '')}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                class={`${BUTTON_CLASS} border-red-900 text-red-300`}
                onClick$={() => (state.confirmAction = 'clear')}
                disabled={isBusy}
              >
                Clear library
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
})

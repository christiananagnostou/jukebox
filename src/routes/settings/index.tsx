import { $, component$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'
import { audioDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { exists } from '@tauri-apps/plugin-fs'

import type { RemoteAccessStatus, Settings, TailscaleStatus } from '~/App'
import { useLibraryImporter } from '~/hooks/useLibraryImporter'
import { clearLibrarySongs, deleteSongs } from '~/services/library-db'
import { getErrorMessage } from '~/utils/Errors'
import { organizeFiles } from '~/utils/Files'
import { StoreContext } from '../layout'

const SECTION_CLASS = 'border-b border-gray-700 pb-6 flex flex-col gap-3'
const BUTTON_CLASS = 'w-fit border border-gray-600 px-3 py-2 text-sm hover:border-gray-400 disabled:opacity-50'
const FILE_CHECK_CONCURRENCY = 32

export default component$(() => {
  const store = useContext(StoreContext)
  const { importPaths } = useLibraryImporter(store)
  const state = useStore({
    confirmAction: '' as '' | 'missing' | 'clear',
    removed: 0,
    remoteAccessBusy: false,
    tailscaleBusy: false,
    tailscaleCopied: false,
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
    } as TailscaleStatus,
  })
  const isBusy = store.sync.status === 'scanning' || store.sync.status === 'importing'

  useVisibleTask$(async () => {
    const [remoteAccess, tailscale] = await Promise.all([
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
      })),
    ])
    state.remoteAccess = remoteAccess
    state.tailscale = tailscale
  })

  const saveSettings = $(async (settings: Settings) => {
    try {
      store.settings = await invoke<Settings>('set_settings', { settings })
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
    }
  })

  const chooseMusicFolder = $(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: store.settings.musicFolder || undefined,
    })

    if (selected && !Array.isArray(selected)) {
      await saveSettings({ ...store.settings, musicFolder: selected })
    }
  })

  const restoreDefaultFolder = $(async () => {
    try {
      const musicFolder = await audioDir()
      await saveSettings({ ...store.settings, musicFolder })
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
    }
  })

  const scanMusicFolder = $(async () => {
    if (store.settings.musicFolder) await importPaths([store.settings.musicFolder], 'scan')
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
    if (state.tailscaleBusy) return
    state.tailscaleBusy = true
    state.tailscaleCopied = false
    try {
      state.tailscale = await invoke<TailscaleStatus>('get_tailscale_status')
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
    } finally {
      state.tailscaleBusy = false
    }
  })

  const copyTailscaleCommand = $(async () => {
    try {
      await navigator.clipboard.writeText('tailscale serve --bg 45321')
      state.tailscaleCopied = true
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
    }
  })

  const resetPlayback = $(() => {
    const audioElement = store.player.audioElem
    if (audioElement) {
      audioElement.pause()
      audioElement.removeAttribute('src')
      delete audioElement.dataset.loadedSongId
      audioElement.load()
    }

    store.playlist = []
    store.queue = []
    store.player.currSong = undefined
    store.player.currSongIndex = 0
    store.player.currentTime = 0
    store.player.duration = 0
    store.player.isPaused = true
  })

  const clearLibrary = $(async () => {
    store.sync.status = 'scanning'
    store.sync.processed = 0
    store.sync.total = 0
    store.sync.message = 'Clearing library'

    try {
      await clearLibrarySongs()
      await resetPlayback()
      store.allSongs = []
      store.filteredSongs = []
      store.libraryView.cursorIdx = 0
      store.storageView.rootFile = organizeFiles([])
      store.storageView.pathIndexMap = {}
      store.storageView.nodeCount = 0
      store.sync.status = 'idle'
      store.sync.message = ''
      state.confirmAction = ''
      state.removed = 0
    } catch (error) {
      store.sync.status = 'error'
      store.sync.message = getErrorMessage(error)
    }
  })

  const removeMissingFiles = $(async () => {
    store.sync.status = 'scanning'
    store.sync.processed = 0
    store.sync.total = store.allSongs.length
    store.sync.message = 'Checking library paths'
    state.removed = 0

    try {
      const missingIds: string[] = []
      for (let start = 0; start < store.allSongs.length; start += FILE_CHECK_CONCURRENCY) {
        const chunk = store.allSongs.slice(start, start + FILE_CHECK_CONCURRENCY)
        const checks = await Promise.all(
          chunk.map(async (song) => {
            try {
              return (await exists(song.path)) ? undefined : song.id
            } catch {
              return song.id
            }
          })
        )
        missingIds.push(...checks.filter((id): id is string => Boolean(id)))
        store.sync.processed += chunk.length
      }

      await deleteSongs(missingIds)
      if (missingIds.length) {
        const missing = new Set(missingIds)
        store.allSongs = store.allSongs.filter((song) => !missing.has(song.id))
        store.playlist = store.playlist.filter((song) => !missing.has(song.id))
        store.queue = store.queue.filter((song) => !missing.has(song.id))
        store.libraryView.cursorIdx = Math.min(store.libraryView.cursorIdx, Math.max(0, store.allSongs.length - 1))
        if (store.player.currSong && missing.has(store.player.currSong.id)) await resetPlayback()
      }

      state.removed = missingIds.length
      state.confirmAction = ''
      store.sync.status = 'idle'
      store.sync.message = ''
      store.sync.lastRunAt = new Date().toISOString()
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
                Runs a private player on this Mac. It only accepts local connections until you securely proxy it.
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
              <div class="border border-gray-700 bg-gray-900 p-3">
                <p class="font-medium text-gray-200">Private iPhone access</p>
                {!state.tailscale.installed ? (
                  <p class="mt-1">
                    Install Tailscale on this Mac and your iPhone, then sign both into the same tailnet.
                  </p>
                ) : state.tailscale.serveConfigured ? (
                  <p class="mt-1 text-emerald-300">
                    Ready{state.tailscale.url ? ` at ${state.tailscale.url}` : ' through Tailscale Serve'}
                  </p>
                ) : state.tailscale.connected ? (
                  <div class="mt-2 flex flex-col gap-2">
                    <p>Tailscale is connected. Run this once in Terminal to add private HTTPS:</p>
                    <code class="overflow-x-auto border border-gray-700 bg-black px-2 py-2 text-gray-200">
                      tailscale serve --bg 45321
                    </code>
                    <button class={BUTTON_CLASS} onClick$={copyTailscaleCommand}>
                      {state.tailscaleCopied ? 'Copied' : 'Copy command'}
                    </button>
                  </div>
                ) : (
                  <div class="mt-1">
                    <p>Open Tailscale and sign in before configuring private HTTPS.</p>
                    {state.tailscale.backendState && <p class="mt-1">State: {state.tailscale.backendState}</p>}
                    {state.tailscale.error && <p class="mt-1 text-red-300">{state.tailscale.error}</p>}
                  </div>
                )}
                <div class="mt-3 flex flex-wrap items-center gap-3">
                  <button class={BUTTON_CLASS} disabled={state.tailscaleBusy} onClick$={refreshTailscale}>
                    {state.tailscaleBusy ? 'Checking…' : 'Check again'}
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
            <h2 class="text-sm font-medium">Music folder</h2>
            <p class="mt-1 truncate text-xs text-gray-400">{store.settings.musicFolder || 'No folder selected'}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class={BUTTON_CLASS} onClick$={chooseMusicFolder} disabled={isBusy}>
              Choose folder
            </button>
            <button class={BUTTON_CLASS} onClick$={restoreDefaultFolder} disabled={isBusy}>
              Use system default
            </button>
            <button class={BUTTON_CLASS} onClick$={scanMusicFolder} disabled={isBusy || !store.settings.musicFolder}>
              Scan now
            </button>
          </div>
        </div>

        <div class={SECTION_CLASS}>
          <div>
            <h2 class="text-sm font-medium">Library cleanup</h2>
            <p class="mt-1 text-xs text-gray-400">Remove unavailable tracks or reset the local catalog.</p>
          </div>

          {isBusy && (
            <progress class="h-2 w-full" value={store.sync.processed} max={store.sync.total || 1}>
              {store.sync.processed}/{store.sync.total}
            </progress>
          )}
          {state.removed > 0 && <p class="text-xs text-gray-400">Removed {state.removed} unavailable tracks.</p>}

          <div class="flex flex-wrap gap-2">
            {state.confirmAction === 'missing' ? (
              <>
                <button class={BUTTON_CLASS} onClick$={removeMissingFiles} disabled={isBusy}>
                  Confirm missing-file cleanup
                </button>
                <button class={BUTTON_CLASS} onClick$={() => (state.confirmAction = '')}>
                  Cancel
                </button>
              </>
            ) : (
              <button class={BUTTON_CLASS} onClick$={() => (state.confirmAction = 'missing')} disabled={isBusy}>
                Remove missing files
              </button>
            )}

            {state.confirmAction === 'clear' ? (
              <>
                <button class={`${BUTTON_CLASS} border-red-700 text-red-300`} onClick$={clearLibrary}>
                  Confirm clear library
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

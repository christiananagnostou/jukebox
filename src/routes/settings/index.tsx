import { $, component$, useContext, useStore } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/core'
import { audioDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { exists } from '@tauri-apps/plugin-fs'
import Database from '@tauri-apps/plugin-sql'

import type { Settings } from '~/App'
import { useLibraryScanner } from '~/hooks/useLibraryScanner'
import { organizeFiles } from '~/utils/Files'
import { LIBRARY_DB, StoreActionsContext, StoreContext } from '../layout'

const SectionClass = 'border border-gray-700 rounded p-4 flex flex-col gap-3 bg-[rgba(0,0,0,.1)]'
const ButtonClass = 'px-3 py-2 text-sm rounded border border-gray-700 hover:border-gray-500 transition'

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const scanner = useLibraryScanner(store, storeActions)
  const cleanupStatus = useStore({ running: false, removed: 0, confirmAction: '' as '' | 'missing' | 'clear' })

  const saveSettings = $(async (next: Settings) => {
    store.settings = next
    await invoke('set_settings', {
      settings: {
        close_on_x: next.closeOnX,
        music_folder: next.musicFolder,
      },
    })
  })

  const toggleCloseOnX = $(async () => {
    await saveSettings({ ...store.settings, closeOnX: !store.settings.closeOnX })
  })

  const changeFolder = $(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: store.settings.musicFolder || undefined,
    })

    if (!selected || Array.isArray(selected)) return
    await saveSettings({ ...store.settings, musicFolder: selected })
  })

  const resetFolder = $(async () => {
    const defaultPath = await audioDir()
    await saveSettings({ ...store.settings, musicFolder: defaultPath })
  })

  const scanNow = $(async () => {
    if (!store.settings.musicFolder) return
    await scanner.scanDirectories([store.settings.musicFolder], 'scan')
  })

  const clearLibrary = $(async () => {
    const db = await Database.load(LIBRARY_DB)
    await db.execute('DELETE FROM songs')
    await db.close()

    store.allSongs = []
    store.filteredSongs = []
    store.playlist = []
    store.queue = []
    store.libraryView.cursorIdx = 0
    store.storageView.rootFile = organizeFiles([])
    store.storageView.pathIndexMap = {}
    store.storageView.nodeCount = 0

    if (store.player.audioElem) {
      store.player.audioElem.pause()
      store.player.audioElem.src = ''
      store.player.audioElem.load()
    }

    store.player.currSong = undefined
    store.player.currSongIndex = 0
    store.player.currentTime = 0
    store.player.duration = 0
    store.player.isPaused = true
    cleanupStatus.confirmAction = ''
  })

  const removeMissingFiles = $(async () => {
    cleanupStatus.running = true
    cleanupStatus.removed = 0
    store.sync.status = 'scanning'
    store.sync.processed = 0
    store.sync.total = store.allSongs.length
    store.sync.message = 'Checking files'

    const missingIds: string[] = []
    for (const song of store.allSongs) {
      try {
        const isPresent = await exists(song.path)
        if (!isPresent) missingIds.push(song.id)
      } catch {
        missingIds.push(song.id)
      }
      store.sync.processed += 1
      if (store.sync.processed % 10 === 0) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
    }

    if (missingIds.length) {
      cleanupStatus.removed = missingIds.length
      const db = await Database.load(LIBRARY_DB)
      for (let i = 0; i < missingIds.length; i += 200) {
        const chunk = missingIds.slice(i, i + 200)
        const placeholders = chunk.map((_, index) => `$${index + 1}`).join(', ')
        await db.execute(`DELETE FROM songs WHERE id IN (${placeholders})`, chunk)
      }
      await db.close()

      const missingSet = new Set(missingIds)
      store.allSongs = store.allSongs.filter((song) => !missingSet.has(song.id))
      store.filteredSongs = store.filteredSongs.filter((song) => !missingSet.has(song.id))
      store.playlist = store.playlist.filter((song) => !missingSet.has(song.id))
      store.queue = store.queue.filter((song) => !missingSet.has(song.id))
      store.libraryView.cursorIdx = Math.min(store.libraryView.cursorIdx, store.filteredSongs.length - 1)
      if (store.libraryView.cursorIdx < 0) store.libraryView.cursorIdx = 0

      if (store.player.currSong && missingSet.has(store.player.currSong.id)) {
        if (store.player.audioElem) {
          store.player.audioElem.pause()
          store.player.audioElem.src = ''
          store.player.audioElem.load()
        }
        store.player.currSong = undefined
        store.player.currSongIndex = 0
        store.player.currentTime = 0
        store.player.duration = 0
        store.player.isPaused = true
      }
    }

    store.sync.status = 'idle'
    store.sync.message = ''
    store.sync.lastRunAt = new Date().toISOString()
    cleanupStatus.running = false
    cleanupStatus.confirmAction = ''
  })

  return (
    <section class="w-full flex-1 p-6 flex flex-col gap-6">
      <div class={SectionClass}>
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-medium">Close app on X</h2>
            <p class="text-xs text-gray-400 mt-1">Stop music and exit instead of hiding to tray.</p>
          </div>
          <button
            role="switch"
            aria-checked={store.settings.closeOnX}
            class={`w-12 h-6 rounded-full border transition ${
              store.settings.closeOnX ? 'bg-emerald-500 border-emerald-400' : 'bg-gray-800 border-gray-700'
            }`}
            onClick$={toggleCloseOnX}
          >
            <span
              class={`block w-5 h-5 rounded-full bg-white transition translate-y-[1px] ${
                store.settings.closeOnX ? 'translate-x-[23px]' : 'translate-x-[1px]'
              }`}
            />
          </button>
        </div>
      </div>

      <div class={SectionClass}>
        <div>
          <h2 class="text-sm font-medium">Default music folder</h2>
          <p class="text-xs text-gray-400 mt-1">New music in this folder is picked up automatically.</p>
        </div>
        <div class="flex items-center gap-3">
          <button class={ButtonClass} onClick$={changeFolder}>
            Change Folder
          </button>
          <button class={ButtonClass} onClick$={resetFolder}>
            Reset to Default
          </button>
          <button class={ButtonClass} onClick$={scanNow}>
            Scan Now
          </button>
        </div>
        <div class="text-xs text-gray-400 truncate">{store.settings.musicFolder || 'Not set'}</div>
      </div>

      <div class={SectionClass}>
        <div>
          <h2 class="text-sm font-medium">Clear library</h2>
          <p class="text-xs text-gray-400 mt-1">Remove everything or clean up missing files.</p>
        </div>
        {(cleanupStatus.running || cleanupStatus.removed > 0) && (
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs text-gray-400">
              <span>
                {cleanupStatus.running
                  ? `Checking ${store.sync.processed}/${store.sync.total}`
                  : `Removed ${cleanupStatus.removed} missing file${cleanupStatus.removed === 1 ? '' : 's'}`}
              </span>
              <span>{store.sync.total > 0 ? Math.round((store.sync.processed / store.sync.total) * 100) : 0}%</span>
            </div>
            <progress
              class="w-full h-2 rounded bg-gray-800 overflow-hidden border border-gray-700 [&::-webkit-progress-bar]:bg-gray-800 [&::-webkit-progress-value]:bg-emerald-400 [&::-moz-progress-bar]:bg-emerald-400"
              value={store.sync.processed}
              max={store.sync.total || 1}
            />
          </div>
        )}
        <div class="flex items-center gap-3">
          {cleanupStatus.confirmAction === 'missing' ? (
            <>
              <button class={ButtonClass} onClick$={removeMissingFiles}>
                Confirm Remove Missing
              </button>
              <button class={ButtonClass} onClick$={() => (cleanupStatus.confirmAction = '')}>
                Cancel
              </button>
            </>
          ) : (
            <button class={ButtonClass} onClick$={() => (cleanupStatus.confirmAction = 'missing')}>
              Remove Missing Files
            </button>
          )}
          {cleanupStatus.confirmAction === 'clear' ? (
            <>
              <button class={ButtonClass + ' text-red-300 hover:text-red-200'} onClick$={clearLibrary}>
                Confirm Clear Library
              </button>
              <button class={ButtonClass} onClick$={() => (cleanupStatus.confirmAction = '')}>
                Cancel
              </button>
            </>
          ) : (
            <button
              class={ButtonClass + ' text-red-300 hover:text-red-200'}
              onClick$={() => (cleanupStatus.confirmAction = 'clear')}
            >
              Clear Library
            </button>
          )}
        </div>
      </div>
    </section>
  )
})

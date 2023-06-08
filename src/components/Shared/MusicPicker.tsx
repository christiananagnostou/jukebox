import { $, component$, useContext, useOnWindow, useVisibleTask$ } from '@builder.io/qwik'
import { listen } from '@tauri-apps/api/event'
import type { FileEntry } from '@tauri-apps/api/fs'
import { readDir } from '@tauri-apps/api/fs'
import { audioDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/api/dialog'
import { invoke } from '@tauri-apps/api/tauri'
import md5 from 'md5'
import { Store as DB } from 'tauri-plugin-store-api'

import type { Metadata, Song } from '~/App'
import { DB_FILE, StoreActionsContext, StoreContext } from '~/routes/layout'
import { isAudioFile } from '~/utils/Files'

// WINDOW_FILE_DROP = 'tauri://file-drop',
// WINDOW_FILE_DROP_HOVER = 'tauri://file-drop-hover',
// WINDOW_FILE_DROP_CANCELLED = 'tauri://file-drop-cancelled',

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const addSong = $(async (filePath: string, fileName: string, db: DB) => {
    if (!isAudioFile(filePath)) return

    const data = await invoke<string>('get_metadata', { filePath })
    if (!data) return

    const metadata = JSON.parse(data) as Metadata

    const { meta_tags } = metadata

    const song: Song = {
      id: md5(filePath),
      path: filePath,
      file: fileName,
      title: meta_tags.TrackTitle || '',
      trackNumber: parseInt(meta_tags.TrackNumber) || 0,
      side: parseInt(meta_tags.Side),
      album: meta_tags.Album || '',
      artist: meta_tags.Artist || '',
      genre: meta_tags.Genre || '',
      bpm: parseInt(meta_tags.Bpm) || 0,
      compilation: parseInt(meta_tags.Compilation) || 0,
      date: meta_tags.Date || '',
      encoder: meta_tags.Encoder || '',
      trackTotal: parseInt(meta_tags.TrackTotal) || 0,
      codec: metadata.codec,
      duration: metadata.duration,
      sampleRate: metadata.sample_rate,

      startTime: 0,
      isFavorite: false,

      visualInfo: {
        mediaData: metadata.visual_info.media_data,
        mediaType: metadata.visual_info.media_type,
      },
    }

    storeActions.addSongInOrder(song)
    await db.set(song.id, song)
  })

  const processEntries = $(async (entries: FileEntry[]) => {
    const db = new DB(DB_FILE)

    const process = async (ent: FileEntry[]) => {
      for (const entry of ent.values()) {
        if (entry.children) {
          process(entry.children.filter((e) => !e.name?.startsWith('.')))
        } else if (entry.name && entry.path) {
          addSong(entry.path, entry.name, db)
        }
      }
    }
    process(entries)
  })

  const addFolder = $(async (folderPath: string) => {
    const entries = await readDir(folderPath, {
      recursive: true,
    })
    await processEntries(entries.filter((e) => !e.name?.startsWith('.')))
  })

  const openDirectoryPicker = $(async () => {
    // Open a selection dialog for directories
    const selected = await open({
      directory: true,
      multiple: true,
      defaultPath: store.audioDir,
    })

    if (Array.isArray(selected)) {
      // User selected multiple directories
      selected.forEach((dir) => addFolder(dir))
    } else if (selected === null) {
      // User cancelled the selection
    } else {
      // User selected a single directory
      addFolder(selected)
    }
  })

  useVisibleTask$(async () => {
    try {
      // Set audio directory for import dialog
      store.audioDir = await audioDir()
    } catch (e) {
      console.log(e)
    }

    const unlistenFileDrop = await listen('tauri://file-drop', async (event) => {
      if (!event.payload) return
      for (const entry of event.payload as string[]) {
        const dir = await readDir(entry, { recursive: true })
        processEntries(dir)
      }
    })

    return () => unlistenFileDrop()
  })

  useOnWindow(
    'keydown',
    $((e: Event) => {
      // @ts-ignore
      const { key } = e as { key: string }
      if (key === 'I') openDirectoryPicker()
    })
  )

  return (
    <button
      onClick$={openDirectoryPicker}
      class="w-full flex items-center justify-between py-1 px-2 border border-transparent hover:border-gray-700 rounded"
    >
      Add Music
      <span class="text-xs text-gray-500">I</span>
    </button>
  )
})

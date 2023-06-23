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
import { ALBUM_ART_DB, METADATA_DB, StoreActionsContext, StoreContext } from '~/routes/layout'
import { isAudioFile } from '~/utils/Files'

// WINDOW_FILE_DROP = 'tauri://file-drop',
// WINDOW_FILE_DROP_HOVER = 'tauri://file-drop-hover',
// WINDOW_FILE_DROP_CANCELLED = 'tauri://file-drop-cancelled',

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  /**
   *
   * If file is an accepted audio file,
   * get metadata from backend and store it in the DB
   *
   */
  const addSong = $(async (filePath: string, fileName: string, metadataDB: DB, albumArtDB: DB) => {
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
      favorRating: 0,
      dateAdded: new Date().toISOString(),
    }

    // If song exists in DB, replace it in allSongs, else add in order
    if (await metadataDB.has(song.id)) store.allSongs[store.allSongs.findIndex((s) => s.id === song.id)] = song
    else storeActions.addSongInOrder(song)

    // Always store latest to DB
    await metadataDB.set(song.id, song)
    await albumArtDB.set(song.id, {
      mediaData: metadata.visual_info.media_data,
      mediaType: metadata.visual_info.media_type,
    })
  })

  /**
   *
   * Recursively read through entries and process each entry or it's children
   *
   */
  const processEntries = $(async (entries: FileEntry[]) => {
    const metadataDB = new DB(METADATA_DB)
    const albumArtDB = new DB(ALBUM_ART_DB)

    const process = async (ent: FileEntry[]) => {
      for (const entry of ent.values()) {
        if (entry.children) {
          process(entry.children.filter((e) => !e.name?.startsWith('.')))
        } else if (entry.name && entry.path) {
          addSong(entry.path, entry.name, metadataDB, albumArtDB)
        }
      }
    }
    process(entries)
  })

  /**
   *
   * Create a tree of file entries from the selected directory
   *
   */
  const addDir = $(async (folderPath: string) => {
    const entries = await readDir(folderPath, { recursive: true })
    await processEntries(entries.filter((e) => !e.name?.startsWith('.')))
  })

  /**
   *
   * Open a import dialog for directories and add selected
   *
   */
  const openDirectoryPicker = $(async () => {
    const selected = await open({
      directory: true,
      multiple: true,
      defaultPath: store.audioDir,
    })

    if (Array.isArray(selected)) {
      // User selected multiple directories
      selected.forEach((dir) => addDir(dir))
    } else if (selected === null) {
      // User cancelled the selection
    } else {
      // User selected a single directory
      addDir(selected)
    }
  })

  /**
   *
   * Set audio directroy for import dialog
   * and
   * Add listener for file drop on the app
   *
   */
  useVisibleTask$(async () => {
    try {
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

  /**
   *
   * Add keyboard event for Shift + I to open import dialog
   *
   */
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

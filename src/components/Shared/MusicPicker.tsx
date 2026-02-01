import { $, component$, useContext, useOnWindow, useVisibleTask$ } from '@builder.io/qwik'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { audioDir, join } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import type { DirEntry } from '@tauri-apps/plugin-fs'
import { readDir } from '@tauri-apps/plugin-fs'
import md5 from 'md5'

import type { Metadata, Song } from '~/App'
import { LIBRARY_DB, StoreActionsContext, StoreContext } from '~/routes/layout'
import { isAudioFile } from '~/utils/Files'
import Database from '@tauri-apps/plugin-sql'

// const WINDOW_FILE_DROP = 'tauri://file-drop'
// const WINDOW_FILE_DROP_HOVER = 'tauri://file-drop-hover'
// const WINDOW_FILE_DROP_CANCELLED = 'tauri://file-drop-cancelled'

export default component$(({ styles }: { styles: { button: string; icon: string } }) => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  /**
   *
   * If file is an accepted audio file,
   * get metadata from backend and store it in the DB
   *
   */
  const addSong = $(async (filePath: string, fileName: string, db: Database) => {
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
      visualsPath: metadata.visual_info.image_path,
    }

    // If song exists in DB, replace it in allSongs, else add in order
    const existingSong = (await db.select('SELECT * FROM songs WHERE id =?', [song.id])) as Song

    if (existingSong) store.allSongs[store.allSongs.findIndex((s) => s.id === song.id)] = song
    else storeActions.addSongInOrder(song)

    const columns = Object.keys(song).join(', ')
    const values = Object.values(song)
    const placeholders = Array.from({ length: values.length }, (_, i) => `$${i + 1}`).join(', ')

    const query = `INSERT INTO songs (${columns}) VALUES (${placeholders})`

    await db.execute(query, values)
  })

  /**
   *
   * Recursively read through entries and process each entry or it's children
   *
   */
  const processEntries = $(async (basePath: string, entries: DirEntry[]) => {
    const db = await Database.load(LIBRARY_DB)

    const process = async (parentPath: string, ent: DirEntry[]) => {
      for (const entry of ent.values()) {
        if (entry.name.startsWith('.')) continue
        const entryPath = await join(parentPath, entry.name)

        if (entry.isDirectory) {
          const nested = await readDir(entryPath)
          await process(entryPath, nested)
        } else if (entry.isFile) {
          await addSong(entryPath, entry.name, db)
        }
      }
    }

    await process(basePath, entries)
    await db.close()
  })

  /**
   *
   * Create a tree of file entries from the selected directory
   *
   */
  const addDir = $(async (folderPath: string) => {
    const entries = await readDir(folderPath)
    await processEntries(folderPath, entries)
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
  // eslint-disable-next-line
  useVisibleTask$(async () => {
    try {
      store.audioDir = await audioDir()
    } catch (e) {
      console.log(e)
    }

    const unlistenFileDrop = await listen('tauri://file-drop', async (event: any) => {
      if (!event.payload) return
      for (const entry of event.payload as string[]) {
        const dir = await readDir(entry)
        await processEntries(entry, dir)
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
    <button onClick$={openDirectoryPicker} class={styles.button}>
      Import Music
      <span class={styles.icon}>I</span>
    </button>
  )
})

import { $, component$, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { invoke } from '@tauri-apps/api/tauri'
import { open } from '@tauri-apps/api/dialog'
import { audioDir } from '@tauri-apps/api/path'
import { readDir, BaseDirectory, type FileEntry } from '@tauri-apps/api/fs'
import { listen } from '@tauri-apps/api/event'

import { getContentFileType } from '~/utils/Files'

// /Users/christian/Music/iTunes/iTunes Media/Music/

interface Song {
  /**
   * A hash of the filepath
   */
  id: string
  path: string
  file: string
  title: string
  artist: string
  album: string
  year: number
  genre: string[]
  trackNumber: number
  duration: string
  metadata: MetadataEntry[]
  fileInfo: any
  songProjectId?: number // Link to project id
  isFavourite: boolean
}

interface MetadataEntry {
  /** The original tag id (from Vorbis / IDv3 / etc) */
  id: string
  /** The tag's value */
  value: string
}

interface Store {
  songsJustAdded: Song[]
  audioDir: string
}

// WINDOW_FILE_DROP = 'tauri://file-drop',
// WINDOW_FILE_DROP_HOVER = 'tauri://file-drop-hover',
// WINDOW_FILE_DROP_CANCELLED = 'tauri://file-drop-cancelled',

export default component$(() => {
  const store = useStore<Store>(
    {
      songsJustAdded: [],
      audioDir: '',
    },
    { deep: true }
  )

  const processEntries = $(async (entries: FileEntry[]) => {
    const process = (ent: FileEntry[]) => {
      for (const [index, entry] of ent.entries()) {
        if (entry.children) {
          // importStatus.update((importStatus) => ({
          //     ...importStatus,
          //     currentFolder: entry.name,
          //     totalTracks: entry.children.length
          // }));
          process(entry.children.filter((e) => !e.name?.startsWith('.')))
        } else {
          console.log(entry.path, entry.name)
          // await addSong(entry.path, entry.name);
          // importStatus.update((importStatus) => ({
          //     ...importStatus,
          //     importedTracks: index
          // }));
        }
      }
    }
    process(entries)
  })

  useVisibleTask$(async () => {
    // Set audio directory for import dialog
    store.audioDir = await audioDir()

    const unlisten = await listen('tauri://file-drop', async (event) => {
      if (!event.payload) return
      for (const entry of event.payload as string[]) {
        const dir = await readDir(entry, { recursive: true })
        processEntries(dir)
      }
    })

    return () => unlisten()
  })

  const addFolder = $(async (folderPath: string) => {
    //   importStatus.update((importStatus) => ({
    //       ...importStatus,
    //       isImporting: true,
    //     }))
    const entries = await readDir(folderPath, {
      dir: BaseDirectory.App,
      recursive: true,
    })

    console.log('entries', entries)
    await processEntries(entries.filter((e) => !e.name?.startsWith('.')))
    // importStatus.set({
    //   totalTracks: 0,
    //   importedTracks: 0,
    //   isImporting: false,
    //   currentFolder: '',
    // })

    // songsJustAdded.set(addedSongs)
    // addedSongs = []
  })

  const openTauriImportDialog = $(async () => {
    // Open a selection dialog for directories
    const selected = await open({
      directory: true,
      multiple: true,
      defaultPath: store.audioDir,
    })
    if (Array.isArray(selected)) {
      selected.forEach((dir) => addFolder(dir))
      // user selected multiple directories
    } else if (selected === null) {
      // user cancelled the selection
    } else {
      addFolder(selected)
      console.log('selected', selected)
      // user selected a single directory
      //   addFolder(selected)
    }
  })

  return (
    <div>
      <div>
        <button onClick$={openTauriImportDialog}>Add Music</button>
      </div>
      <div>
        <input type="text" value={store.audioDir} onChange$={(e) => (store.audioDir = e.target.value)} />

        {store.songsJustAdded.map((song) => (
          <div>{song.title}</div>
        ))}
      </div>
    </div>
  )
})

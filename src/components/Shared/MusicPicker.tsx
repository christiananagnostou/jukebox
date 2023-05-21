import { $, component$, useContext, useVisibleTask$ } from '@builder.io/qwik'
import { listen } from '@tauri-apps/api/event'
import type { FileEntry } from '@tauri-apps/api/fs'
import { readDir } from '@tauri-apps/api/fs'
import { audioDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/api/dialog'
import md5 from 'md5'
import type { Song } from '~/App'
import { StoreContext } from '~/routes/layout'
import { isAudioFile } from '~/utils/Files'

// WINDOW_FILE_DROP = 'tauri://file-drop',
// WINDOW_FILE_DROP_HOVER = 'tauri://file-drop-hover',
// WINDOW_FILE_DROP_CANCELLED = 'tauri://file-drop-cancelled',

export default component$(() => {
  const store = useContext(StoreContext)

  const addSong = $(async (filePath: string, fileName: string) => {
    if (!isAudioFile(filePath)) return
    const format = 'Artist/Album/[side-track]Title'
    const splitFormat = format.split('/')
    const splitPath = filePath.split('/').slice(-3)

    const [first, ...rest] = splitPath[splitFormat.indexOf('[side-track]Title')].split(' ')
    const [side, track] = first.split('-')

    const title = rest.join(' ').substring(0, rest.join(' ').lastIndexOf('.'))

    const songToAdd: Song = {
      id: md5(filePath),
      path: filePath,
      file: fileName,
      title: title,
      track: parseInt(track || side),
      side: parseInt(track ?? side),
      album: splitPath[splitFormat.indexOf('Album')],
      artist: splitPath[splitFormat.indexOf('Artist')],
      startTime: 0,
      isFavorite: false,
    }

    store.allSongs.push(songToAdd)
  })

  const processEntries = $(async (entries: FileEntry[]) => {
    const process = async (ent: FileEntry[]) => {
      for (const entry of ent.values()) {
        if (entry.children) {
          process(entry.children.filter((e) => !e.name?.startsWith('.')))
        } else if (entry.name && entry.path) {
          addSong(entry.path, entry.name)
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
      // user selected multiple directories
      selected.forEach((dir) => addFolder(dir))
    } else if (selected === null) {
      // user cancelled the selection
    } else {
      // user selected a single directory
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

  return (
    <button onClick$={openDirectoryPicker} class="bg-gray-700 py-[2px] px-4 rounded text-sm">
      Add Music
    </button>
  )
})

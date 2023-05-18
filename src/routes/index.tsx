import { $, component$, useContext, useSignal, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { type DocumentHead } from '@builder.io/qwik-city'
import { appWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/api/dialog'
import { audioDir } from '@tauri-apps/api/path'
import { readDir, BaseDirectory, type FileEntry } from '@tauri-apps/api/fs'
import { listen } from '@tauri-apps/api/event'
import md5 from 'md5'

import { isAudioFile } from '~/utils/Files'
import VirtualList from '~/components/Shared/VirtualList'
import type { Song, ListItemStyle } from '~/App'
import { StoreActionsContext, StoreContext } from './layout'

const RowHeight = 30

// WINDOW_FILE_DROP = 'tauri://file-drop',
// WINDOW_FILE_DROP_HOVER = 'tauri://file-drop-hover',
// WINDOW_FILE_DROP_CANCELLED = 'tauri://file-drop-cancelled',

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const virtualListElem = useSignal<Element>()
  const state = useStore({ virtualListHeight: virtualListElem.value?.clientHeight, windowHeight: 0 })

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
      title: title.replace(/_\s*/g, ':'),
      track: parseInt(track || side),
      side: parseInt(track ?? side),
      album: splitPath[splitFormat.indexOf('Album')],
      artist: splitPath[splitFormat.indexOf('Artist')],
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
      dir: BaseDirectory.App,
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
    // Set audio directory for import dialog
    store.audioDir = await audioDir()

    state.virtualListHeight = virtualListElem.value?.clientHeight
    state.windowHeight = (await appWindow.outerSize()).height

    const unlistenResize = await appWindow.onResized(async ({ payload: size }) => {
      if (!virtualListElem.value) return
      const factor = await appWindow.scaleFactor()
      const logical = size.toLogical(factor)
      state.virtualListHeight = logical.height - RowHeight * 3 - 28 // 3 rows plus top bar - 2px
      state.windowHeight = logical.height
    })

    const unlistenFileDrop = await listen('tauri://file-drop', async (event) => {
      if (!event.payload) return
      for (const entry of event.payload as string[]) {
        const dir = await readDir(entry, { recursive: true })
        processEntries(dir)
      }
    })

    return () => {
      unlistenFileDrop()
      unlistenResize()
    }
  })

  return (
    <div class="w-full flex flex-col flex-1">
      <div class="flex items-center justify-end px-2" style={{ height: RowHeight + 'px' }}>
        <button onClick$={openDirectoryPicker} class="bg-gray-700 px-4 py-[2px] rounded text-sm">
          Add Music
        </button>
      </div>

      <section class="w-full flex flex-col flex-1">
        <div
          class="px-2 w-full text-sm grid grid-cols-4 items-center text-left border-b border-t border-gray-800"
          style={{ height: RowHeight + 'px' }}
        >
          <span class="truncate">Title</span>
          <span class="truncate">Artist</span>
          <span class="truncate">Album</span>
        </div>

        <div ref={virtualListElem} class="flex-1 h-full" style={{ maxHeight: state.virtualListHeight + 'px' }}>
          <VirtualList
            numItems={store.allSongs.length}
            itemHeight={RowHeight}
            windowHeight={state.virtualListHeight || 0}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const song = store.allSongs[index]

              return (
                <button
                  key={song.title}
                  onDblClick$={() => storeActions.playSong(song, index)}
                  style={{ ...style, height: RowHeight + 'px' }}
                  class={`px-2 border-t first:border-t-0 border-r border-gray-800 w-full text-sm grid grid-cols-4 text-left items-center
        ${store.player.currSong?.id === song.id ? 'bg-gray-800' : ''}`}
                >
                  <span class="truncate">{song.title}</span>
                  <span class="truncate">{song.artist}</span>
                  <span class="truncate">{song.album}</span>
                  <span>{index}</span>
                </button>
              )
            })}
          />
        </div>
      </section>
    </div>
  )
})

export const head: DocumentHead = {
  title: 'Library',
  meta: [
    {
      name: 'description',
      content: 'Qwik site description',
    },
  ],
}

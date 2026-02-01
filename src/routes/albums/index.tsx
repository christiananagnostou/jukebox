import { $, component$, useComputed$, useContext, useSignal, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { StoreActionsContext, StoreContext } from '../layout'
import type { ListItemStyle, Song } from '~/App'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { convertFileSrc } from '@tauri-apps/api/core'
import VirtualList from '~/components/Shared/VirtualList'
import { MusicNote } from '~/components/svg/MusicNote'
// import { ArrowDown } from '~/components/svg/ArrowDown'
// import { ArrowUp } from '~/components/svg/ArrowUp'

interface Album {
  albumArtSRC: string
  artist: string
  date: string
  songs: Song[]
}

interface Albums {
  [album: string]: Album
}

type AlbumItem = [string, Album]

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const containerRef = useSignal<Element>()

  const state = useStore({
    virtualListHeight: 0,
    windowHeight: 0,

    rowHeight: 500,
    numCols: 5,
  })

  useVisibleTask$(async () => {
    const appWindow = getCurrentWebviewWindow()
    const sizeVirtualList = async () => {
      const factor = await appWindow.scaleFactor()
      const { height } = (await appWindow.innerSize()).toLogical(factor)
      state.virtualListHeight = height - 29 - 29 - 30 - 16 // 29 for search and filters, 20 for app bar, 16 for top padding
      state.windowHeight = height
    }
    sizeVirtualList()
    const unlistenResize = await appWindow.onResized(sizeVirtualList)
    return () => unlistenResize()
  })

  const chunk = $((arr: AlbumItem[], len: number) => {
    const chunks = []
    let i = 0
    const n = arr.length

    while (i < n) {
      chunks.push(arr.slice(i, (i += len)))
    }

    return chunks
  })

  const albums = useComputed$(async () => {
    const a: Albums = {}

    for (const song of store.filteredSongs) {
      const album = a[song.album]
      if (album) {
        if (album.date < song.date) {
          album.date = song.date
        }

        album.songs.push(song)
      } else {
        a[song.album] = {
          albumArtSRC: song.visualsPath ? convertFileSrc(song.visualsPath) : '',
          artist: song.artist,
          date: song.date,
          songs: [song],
        }
      }
    }

    return await chunk(Object.entries(a), state.numCols)
  })

  useVisibleTask$(({ track }) => {
    if (!containerRef.value) return
    track(() => store.filteredSongs)

    const outputsize = () => {
      const containerWidth = containerRef.value?.clientWidth || 0
      const padding = 16 * (state.numCols + 1)
      const scrollbar = 8
      const albumWidth = (containerWidth - padding - scrollbar) / state.numCols
      const infoHeight = 106
      const rowPadding = 16
      const border = 2

      state.rowHeight = albumWidth + infoHeight + rowPadding + border
    }
    outputsize()

    new ResizeObserver(outputsize).observe(containerRef.value)
  })

  return (
    <>
      <div
        class="w-full text-sm border-b border-slate-700 flex items-center justify-between"
        style={{ height: 30 + 'px', paddingRight: 'var(--scrollbar-width)' }}
      ></div>

      <div class="overflow-auto">
        <div class="flex-1 h-full" style={{ maxHeight: state.virtualListHeight + 'px' }} ref={containerRef}>
          {albums.value && (
            <VirtualList
              numItems={albums.value.length}
              itemHeight={state.rowHeight}
              overscan={2}
              windowHeight={state.virtualListHeight || 0}
              scrollToRow={store.libraryView.cursorIdx}
              renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
                const row = albums.value[index]
                return (
                  // Row
                  <div class="w-full flex gap-x-4 px-4 pt-4" style={{ ...style, height: state.rowHeight + 'px' }}>
                    {row.map(([albumName, { albumArtSRC, songs, artist, date }]) => (
                      // Column
                      <div
                        class="album-container flex flex-col h-fit flex-1 w-0 border border-slate-700 cursor-pointer transition-all hover:border-slate-500 hover:shadow-xl"
                        key={albumName}
                        onDblClick$={() => {
                          store.playlist = songs
                          storeActions.playSong(songs[0], 0)
                        }}
                      >
                        <div class="min-w-full aspect-square bg-gray-800">
                          {albumArtSRC ? (
                            <img
                              src={albumArtSRC}
                              alt={albumName}
                              width={250}
                              height={250}
                              class="block m-auto w-auto h-full"
                            />
                          ) : (
                            <div class="h-full w-full grid place-items-center text-gray-700">
                              <MusicNote height="20%" width="20%" />
                            </div>
                          )}
                        </div>
                        <div class="p-2 h-full">
                          <span class="truncate py-1 block text-lg font-light">{albumName || '-'}</span>
                          <span class="truncate py-1 block mb-1 text-slate-300">{artist || '-'}</span>

                          <span class="truncate py-1 block float-left text-sm text-slate-300">{date || '-'}</span>
                          <span class="truncate py-1 block float-right text-sm text-slate-300">
                            {songs.length || '-'} <span class="text-xs text-slate-500">tracks</span>
                          </span>
                        </div>
                      </div>
                    ))}

                    {[...Array(state.numCols - row.length)].map((item) => (
                      <div class="flex-1 w-0 album-container" key={item} />
                    ))}
                  </div>
                )
              })}
            />
          )}
        </div>
      </div>
    </>
  )
})

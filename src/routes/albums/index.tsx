import { $, component$, useComputed$, useContext, useSignal, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { ALBUM_ART_DB, StoreActionsContext, StoreContext } from '../layout'
import { Store as DB } from 'tauri-plugin-store-api'
import type { AlbumArt, ListItemStyle, Song } from '~/App'
import { appWindow } from '@tauri-apps/api/window'
import VirtualList from '~/components/Shared/VirtualList'
import { ArrowDown } from '~/components/svg/ArrowDown'
import { ArrowUp } from '~/components/svg/ArrowUp'

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

const AlbumArtDB = new DB(ALBUM_ART_DB)

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
    const sizeVirtualList = async () => {
      const factor = await appWindow.scaleFactor()
      const { height } = (await appWindow.innerSize()).toLogical(factor)
      state.virtualListHeight = height - 30 * 2 - 28 // 2 rows (col titles + footer)
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
        album.date < song.date && (album.date = song.date)

        album.songs.push(song)
      } else {
        const visualInfo = (await AlbumArtDB.get(song.id)) as AlbumArt

        let albumArtSRC = ''

        if (visualInfo.mediaData && visualInfo.mediaType) {
          const content = new Uint8Array(visualInfo.mediaData)
          albumArtSRC = URL.createObjectURL(new Blob([content.buffer], { type: visualInfo.mediaType }))
        }

        a[song.album] = {
          albumArtSRC,
          artist: song.artist,
          date: song.date,
          songs: [song],
        }
      }
    }

    // return chunk(Object.entries(a), Math.floor(state.rowWidth / (containerRef.value?.clientWidth || 1)))
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
      const infoHeight = 110
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
        class="w-full text-sm grid grid-cols-[22px_1fr_1fr_1fr_120px_120px_120px_70px] text-left items-center border-b border-gray-700"
        style={{ height: 30 + 'px', paddingRight: 'var(--scrollbar-width)' }}
      >
        <span />

        <button
          class="truncate h-full flex items-center justify-between pl-1 pr-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'title-desc' ? 'title-asc' : 'title-desc')}
        >
          Title
          {store.sorting === 'title-desc' && <ArrowDown />}
          {store.sorting === 'title-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'artist-desc' ? 'artist-asc' : 'artist-desc')}
        >
          Artist
          {store.sorting === 'artist-desc' && <ArrowDown />}
          {store.sorting === 'artist-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'album-desc' ? 'album-asc' : 'album-desc')}
        >
          Album
          {store.sorting === 'album-desc' && <ArrowDown />}
          {store.sorting === 'album-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'track-desc' ? 'track-asc' : 'track-desc')}
        >
          Track
          {store.sorting === 'track-desc' && <ArrowDown />}
          {store.sorting === 'track-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'hertz-desc' ? 'hertz-asc' : 'hertz-desc')}
        >
          Hertz
          {store.sorting === 'hertz-desc' && <ArrowDown />}
          {store.sorting === 'hertz-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'date-desc' ? 'date-asc' : 'date-desc')}
        >
          Date
          {store.sorting === 'date-desc' && <ArrowDown />}
          {store.sorting === 'date-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'fave-desc' ? 'fave-asc' : 'fave-desc')}
        >
          Fave
          {store.sorting === 'fave-desc' && <ArrowDown />}
          {store.sorting === 'fave-asc' && <ArrowUp />}
        </button>
      </div>

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
                  <div
                    class="w-full flex gap-4 px-4 pt-4 last:pb-4"
                    style={{ ...style, height: state.rowHeight + 'px' }}
                  >
                    {row.map(([albumName, { albumArtSRC, songs, artist, date }]) => (
                      // Column
                      <div
                        class="album-container flex flex-col h-fit flex-1 w-0 border border-slate-700 cursor-pointer"
                        key={albumName}
                        onDblClick$={() => {
                          store.playlist = songs
                          storeActions.playSong(songs[0], 0)
                        }}
                      >
                        <div class="min-w-full aspect-square bg-gray-800">
                          {albumArtSRC && (
                            <img
                              src={albumArtSRC}
                              alt={albumName}
                              width={250}
                              height={250}
                              class="block m-auto w-auto h-full"
                            />
                          )}
                        </div>
                        <div class="p-2 h-full">
                          <span class="truncate py-1 block text-2xl font-light">{albumName || '-'}</span>
                          <span class="truncate py-1 block mb-1">{artist || '-'}</span>

                          <span class="truncate py-1 block float-left">{date || '-'}</span>
                          <span class="truncate py-1 block float-right">
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

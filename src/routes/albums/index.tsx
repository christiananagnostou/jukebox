import { component$, useComputed$, useContext, useSignal, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { ALBUM_ART_DB, StoreContext } from '../layout'
import { Store as DB } from 'tauri-plugin-store-api'
import type { AlbumArt, ListItemStyle, Song } from '~/App'
import { appWindow } from '@tauri-apps/api/window'
import VirtualList from '~/components/Shared/VirtualList'

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

function chunk(arr: AlbumItem[], len: number) {
  const chunks = []
  let i = 0
  const n = arr.length

  while (i < n) {
    chunks.push(arr.slice(i, (i += len)))
  }

  return chunks
}

const AlbumArtDB = new DB(ALBUM_ART_DB)

export default component$(() => {
  const store = useContext(StoreContext)

  const containerRef = useSignal<Element | undefined>()

  const state = useStore({
    virtualListHeight: 0,
    windowHeight: 0,

    rowHeight: 500,
    rowWidth: 300,
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
    return chunk(Object.entries(a), 5)
  })

  return (
    <div class="overflow-auto">
      <div class="flex-1 h-full" style={{ maxHeight: state.virtualListHeight + 'px' }} ref={containerRef}>
        {albums.value && (
          <VirtualList
            numItems={albums.value.length}
            itemHeight={state.rowHeight}
            windowHeight={state.virtualListHeight || 0}
            scrollToRow={store.libraryView.cursorIdx}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const row = albums.value[index]

              return (
                <div class="w-full flex" style={{ ...style, height: state.rowHeight }}>
                  {row.map(([albumName, { albumArtSRC, songs, artist, date }]) => (
                    <div
                      class="flex flex-col flex-1"
                      key={albumName}
                      style={{ width: state.rowWidth, maxWidth: state.rowWidth }}
                    >
                      <div class="min-w-full aspect-square bg-slate-800">
                        {albumArtSRC && <img src={albumArtSRC} alt={albumName} width={250} height={250} />}
                      </div>
                      <span class="truncate">{albumName}</span>
                      <span class="truncate">{songs.length}</span>
                      <span class="truncate">{artist}</span>
                      <span class="truncate">{date}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          />
        )}
      </div>
    </div>
  )
})

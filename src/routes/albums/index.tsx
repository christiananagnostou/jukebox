import { component$, useComputed$, useContext, useSignal, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { convertFileSrc } from '@tauri-apps/api/core'

import type { ListItemStyle, Song } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import { MusicNote } from '~/components/svg/MusicNote'
import { useLegacyCatalog } from '~/services/library-client'
import { StoreActionsContext, StoreContext } from '../layout'

const ALBUM_GAP = 16
const ALBUM_INFO_HEIGHT = 124
const MIN_ALBUM_WIDTH = 180

interface AlbumSummary {
  albumArtSrc: string
  artist: string
  date: string
  key: string
  name: string
  songs: Song[]
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const containerRef = useSignal<HTMLDivElement>()
  const state = useStore({
    rowHeight: 360,
    numCols: 5,
  })

  useLegacyCatalog(store)

  const albumRows = useComputed$(() => {
    const albumsByKey = new Map<string, AlbumSummary>()

    for (const song of store.filteredSongs) {
      const key = `${song.artist}\0${song.album}`
      const album = albumsByKey.get(key)

      if (album) {
        if (album.date < song.date) album.date = song.date
        album.songs.push(song)
      } else {
        albumsByKey.set(key, {
          albumArtSrc: song.visualsPath ? convertFileSrc(song.visualsPath) : '',
          artist: song.artist,
          date: song.date,
          key,
          name: song.album,
          songs: [song],
        })
      }
    }

    return chunk([...albumsByKey.values()], state.numCols)
  })

  useVisibleTask$(({ cleanup }) => {
    const container = containerRef.value
    if (!container) return

    const updateGrid = () => {
      const width = container.clientWidth
      const numCols = Math.max(1, Math.floor((width - ALBUM_GAP) / (MIN_ALBUM_WIDTH + ALBUM_GAP)))
      const albumWidth = (width - ALBUM_GAP * (numCols + 1)) / numCols

      state.numCols = numCols
      state.rowHeight = albumWidth + ALBUM_INFO_HEIGHT + ALBUM_GAP
    }
    const resizeObserver = new ResizeObserver(updateGrid)

    updateGrid()
    resizeObserver.observe(container)
    cleanup(() => resizeObserver.disconnect())
  })

  return (
    <section class="min-h-0 flex flex-1" ref={containerRef}>
      <VirtualList
        numItems={albumRows.value.length}
        itemHeight={state.rowHeight}
        overscan={2}
        renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
          const row = albumRows.value[index]

          return (
            <div class="w-full flex gap-4 px-4 pt-4" style={{ ...style, height: `${state.rowHeight}px` }}>
              {row.map(({ albumArtSrc, songs, artist, date, key, name }) => (
                <button
                  class="album-container flex h-fit w-0 flex-1 cursor-pointer flex-col border border-slate-700 text-left hover:border-slate-500"
                  key={key}
                  onDblClick$={() => {
                    const firstSong = songs[0]
                    if (!firstSong) return
                    store.playlist = songs
                    storeActions.playSong(firstSong, 0)
                  }}
                >
                  <div class="min-w-full aspect-square bg-gray-800">
                    {albumArtSrc ? (
                      <img
                        src={albumArtSrc}
                        alt=""
                        width={250}
                        height={250}
                        loading="lazy"
                        decoding="async"
                        class="block m-auto w-auto h-full"
                      />
                    ) : (
                      <div class="h-full w-full grid place-items-center text-gray-700">
                        <MusicNote height="20%" width="20%" />
                      </div>
                    )}
                  </div>
                  <div class="p-2 h-full w-full">
                    <span class="truncate py-1 block text-lg font-light">{name || '-'}</span>
                    <span class="truncate py-1 block mb-1 text-slate-300">{artist || '-'}</span>
                    <span class="truncate py-1 block float-left text-sm text-slate-300">{date || '-'}</span>
                    <span class="truncate py-1 block float-right text-sm text-slate-300">
                      {songs.length} <span class="text-xs text-slate-500">tracks</span>
                    </span>
                  </div>
                </button>
              ))}

              {Array.from({ length: state.numCols - row.length }, (_, index) => (
                <div class="flex-1 w-0" key={index} />
              ))}
            </div>
          )
        })}
      />
    </section>
  )
})

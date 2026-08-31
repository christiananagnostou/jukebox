import {
  $,
  component$,
  noSerialize,
  useContext,
  useSignal,
  useStore,
  useTask$,
  useVisibleTask$,
  type NoSerialize,
} from '@builder.io/qwik'
import { convertFileSrc } from '@tauri-apps/api/core'

import type { ListItemStyle } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import { MusicNote } from '~/components/svg/MusicNote'
import {
  aggregateItemAt,
  AggregatePager,
  type AggregateCatalogState,
  type AlbumSummary,
  loadTrackSelection,
  queryAlbums,
} from '~/services/library-client'
import { StoreActionsContext, StoreContext } from '../layout'

const ALBUM_GAP = 16
const ALBUM_INFO_HEIGHT = 124
const MIN_ALBUM_WIDTH = 180

function aggregateState(): AggregateCatalogState<AlbumSummary> {
  return { error: '', pages: {}, revision: 0, status: 'loading', total: 0 }
}

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const albums = useStore(aggregateState())
  const pager = useSignal<NoSerialize<AggregatePager<AlbumSummary>>>()
  const containerRef = useSignal<HTMLDivElement>()
  const observedRefreshKey = useSignal(store.libraryCatalog.refreshKey)
  const grid = useStore({ rowHeight: 360, numCols: 5 })
  const direction = store.sorting.endsWith('-desc') ? 'desc' : 'asc'
  const rowCount = Math.ceil(albums.total / grid.numCols)

  useVisibleTask$(({ cleanup }) => {
    const controller = new AggregatePager(albums, queryAlbums)
    pager.value = noSerialize(controller)
    void controller.reset({ direction, q: store.searchTerm })

    cleanup(() => {
      controller.dispose()
      pager.value = undefined
    })
  })

  useTask$(({ cleanup, track }) => {
    const searchTerm = track(() => store.searchTerm)
    const sorting = track(() => store.sorting)
    const nextDirection = sorting.endsWith('-desc') ? 'desc' : 'asc'
    const timeout = setTimeout(() => void pager.value?.reset({ direction: nextDirection, q: searchTerm }), 120)
    cleanup(() => clearTimeout(timeout))
  })

  useTask$(({ track }) => {
    const refreshKey = track(() => store.libraryCatalog.refreshKey)
    if (refreshKey === observedRefreshKey.value) return
    observedRefreshKey.value = refreshKey
    void pager.value?.reload()
  })

  useVisibleTask$(({ cleanup }) => {
    const container = containerRef.value
    if (!container) return

    const updateGrid = () => {
      const width = container.clientWidth
      const numCols = Math.max(1, Math.floor((width - ALBUM_GAP) / (MIN_ALBUM_WIDTH + ALBUM_GAP)))
      const albumWidth = (width - ALBUM_GAP * (numCols + 1)) / numCols

      grid.numCols = numCols
      grid.rowHeight = albumWidth + ALBUM_INFO_HEIGHT + ALBUM_GAP
    }
    const resizeObserver = new ResizeObserver(updateGrid)

    updateGrid()
    resizeObserver.observe(container)
    cleanup(() => resizeObserver.disconnect())
  })

  const playAlbum = $(async (album: AlbumSummary) => {
    try {
      const songs = await loadTrackSelection({
        album: album.value,
        artist: album.artistValue,
        direction: 'asc',
        q: store.searchTerm,
        sort: 'track',
      })
      const firstSong = songs[0]
      if (!firstSong) return
      storeActions.playTracks(songs, 0, { kind: 'album', label: album.name })
      store.bootstrap.libraryError = ''
    } catch {
      store.bootstrap.libraryError = 'Jukebox could not prepare that album for playback.'
    }
  })

  return (
    <section class="min-h-0 flex flex-1 relative" ref={containerRef}>
      {albums.error && (
        <p class="absolute inset-x-4 top-4 z-10 border border-red-900 bg-gray-950 p-3 text-sm text-red-300">
          {albums.error}
        </p>
      )}
      <VirtualList
        numItems={rowCount}
        itemHeight={grid.rowHeight}
        overscan={2}
        onRangeChange={$((startRow, endRow) =>
          pager.value?.ensureRange(startRow * grid.numCols, (endRow + 1) * grid.numCols - 1)
        )}
        renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
          const startIndex = index * grid.numCols
          const indexes = Array.from({ length: grid.numCols }, (_, offset) => startIndex + offset).filter(
            (albumIndex) => albumIndex < albums.total
          )

          return (
            <div class="w-full flex gap-4 px-4 pt-4" style={{ ...style, height: `${grid.rowHeight}px` }}>
              {indexes.map((albumIndex) => {
                const album = aggregateItemAt(albums, albumIndex)
                if (!album) {
                  return <div class="h-full w-0 flex-1 bg-gray-900" key={albumIndex} aria-hidden="true" />
                }
                const albumArtSrc = album.visualsPath ? convertFileSrc(album.visualsPath) : ''
                return (
                  <button
                    class="album-container flex h-fit w-0 flex-1 cursor-pointer flex-col border border-slate-700 text-left hover:border-slate-500"
                    key={`${album.artistValue}\0${album.value}`}
                    onDblClick$={() => playAlbum(album)}
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
                      <span class="truncate py-1 block text-lg font-light">{album.name}</span>
                      <span class="truncate py-1 block mb-1 text-slate-300">{album.artist}</span>
                      <span class="truncate py-1 block float-left text-sm text-slate-300">{album.date || '-'}</span>
                      <span class="truncate py-1 block float-right text-sm text-slate-300">
                        {album.trackCount} <span class="text-xs text-slate-500">tracks</span>
                      </span>
                    </div>
                  </button>
                )
              })}

              {Array.from({ length: grid.numCols - indexes.length }, (_, index) => (
                <div class="flex-1 w-0" key={index} />
              ))}
            </div>
          )
        })}
      />
    </section>
  )
})

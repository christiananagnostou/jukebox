import {
  $,
  component$,
  noSerialize,
  useContext,
  useSignal,
  useTask$,
  useVisibleTask$,
  type NoSerialize,
} from '@builder.io/qwik'

import type { ListItemStyle, Song } from '~/App'
import { SoundBars } from '~/components/Shared/SoundBars'
import VirtualList from '~/components/Shared/VirtualList'
import { ArrowDown } from '~/components/svg/ArrowDown'
import { ArrowUp } from '~/components/svg/ArrowUp'
import {
  aggregateItemAt,
  AGGREGATE_PAGE_SIZE,
  AggregatePager,
  type AlbumSummary,
  type ArtistSummary,
  LibraryPager,
  librarySongAt,
  loadTrackSelection,
  queryAlbums,
  queryArtists,
} from '~/services/library-client'
import { StoreActionsContext, StoreContext } from '../layout'

const ROW_HEIGHT = 30

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const artistPager = useSignal<NoSerialize<AggregatePager<ArtistSummary>>>()
  const albumPager = useSignal<NoSerialize<AggregatePager<AlbumSummary>>>()
  const trackPager = useSignal<NoSerialize<LibraryPager>>()
  const observedRefreshKey = useSignal(store.libraryCatalog.refreshKey)
  const direction = store.sorting === 'artist-desc' ? 'desc' : 'asc'

  useVisibleTask$(({ cleanup }) => {
    const artists = new AggregatePager(store.artistView.artists, queryArtists)
    const albums = new AggregatePager(store.artistView.albums, queryAlbums)
    const tracks = new LibraryPager(store.artistView.tracks)
    artistPager.value = noSerialize(artists)
    albumPager.value = noSerialize(albums)
    trackPager.value = noSerialize(tracks)
    void artists.reset({ direction, q: store.searchTerm })

    cleanup(() => {
      artists.dispose()
      albums.dispose()
      tracks.dispose()
      artistPager.value = undefined
      albumPager.value = undefined
      trackPager.value = undefined
    })
  })

  useTask$(({ cleanup, track }) => {
    const searchTerm = track(() => store.searchTerm)
    const sorting = track(() => store.sorting)
    const nextDirection = sorting === 'artist-desc' ? 'desc' : 'asc'
    const timeout = setTimeout(() => {
      store.artistView.artistIdx = 0
      store.artistView.albumIdx = 0
      store.artistView.trackIdx = 0
      store.artistView.selectedArtistKey = ''
      store.artistView.selectedAlbumKey = ''
      albumPager.value?.clear()
      trackPager.value?.clear()
      void artistPager.value?.reset({ direction: nextDirection, q: searchTerm })
    }, 120)
    cleanup(() => clearTimeout(timeout))
  })

  useTask$(({ track }) => {
    const artistIdx = track(() => store.artistView.artistIdx)
    const pageIndex = Math.floor(artistIdx / AGGREGATE_PAGE_SIZE)
    track(() => store.artistView.artists.pages[String(pageIndex)])
    const artist = aggregateItemAt(store.artistView.artists, artistIdx)
    if (!artist) {
      void artistPager.value?.ensureRange(artistIdx, artistIdx)
      return
    }
    const artistKey = JSON.stringify([artist.value])
    if (artistKey === store.artistView.selectedArtistKey) return

    store.artistView.selectedArtistKey = artistKey
    store.artistView.selectedAlbumKey = ''
    store.artistView.albumIdx = 0
    store.artistView.trackIdx = 0
    trackPager.value?.clear()
    void albumPager.value?.reset({ artist: artist.value, direction: 'asc', q: store.searchTerm })
  })

  useTask$(({ track }) => {
    const albumIdx = track(() => store.artistView.albumIdx)
    const pageIndex = Math.floor(albumIdx / AGGREGATE_PAGE_SIZE)
    track(() => store.artistView.albums.pages[String(pageIndex)])
    const album = aggregateItemAt(store.artistView.albums, albumIdx)
    if (!album) {
      if (store.artistView.albums.total) void albumPager.value?.ensureRange(albumIdx, albumIdx)
      return
    }
    const albumKey = JSON.stringify([album.artistValue, album.value])
    if (albumKey === store.artistView.selectedAlbumKey) return

    store.artistView.selectedAlbumKey = albumKey
    store.artistView.trackIdx = 0
    void trackPager.value?.resetQuery({
      album: album.value,
      artist: album.artistValue,
      direction: 'asc',
      q: store.searchTerm,
      sort: 'track',
    })
  })

  useTask$(({ track }) => {
    const refreshKey = track(() => store.libraryCatalog.refreshKey)
    if (refreshKey === observedRefreshKey.value) return
    observedRefreshKey.value = refreshKey
    store.artistView.selectedArtistKey = ''
    store.artistView.selectedAlbumKey = ''
    albumPager.value?.clear()
    trackPager.value?.clear()
    void artistPager.value?.reload()
  })

  const playSelection = $(async (query: { album?: string; artist: string; sort: 'default' | 'track' }, song?: Song) => {
    try {
      const songs = await loadTrackSelection({ ...query, direction: 'asc', q: store.searchTerm })
      const playlistIndex = song ? songs.findIndex((item) => item.id === song.id) : 0
      if (playlistIndex < 0 || !songs[playlistIndex]) return
      store.playlist = songs
      storeActions.playSong(songs[playlistIndex], playlistIndex)
      store.bootstrap.libraryError = ''
    } catch {
      store.bootstrap.libraryError = 'Jukebox could not prepare that selection for playback.'
    }
  })

  const error = store.artistView.artists.error || store.artistView.albums.error || store.artistView.tracks.error

  return (
    <section class="min-h-0 w-full flex flex-col flex-1 relative">
      {error && (
        <p class="absolute inset-x-4 top-10 z-10 border border-red-900 bg-gray-950 p-3 text-sm text-red-300">{error}</p>
      )}
      <div
        class="w-full text-sm grid grid-cols-[1fr_1fr_1fr] text-left items-center border-b border-gray-700"
        style={{ height: ROW_HEIGHT + 'px' }}
      >
        <button
          class="truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'artist-asc' ? 'artist-desc' : 'artist-asc')}
          style={{ paddingRight: 'var(--scrollbar-width)' }}
        >
          Artists
          {store.sorting === 'artist-desc' && <ArrowDown />}
          {store.sorting === 'artist-asc' && <ArrowUp />}
        </button>
        <div
          class="border-l border-gray-700 truncate h-full flex items-center px-2"
          style={{ paddingRight: 'var(--scrollbar-width)' }}
        >
          Albums
        </div>
        <div
          class="border-l border-gray-700 truncate h-full flex items-center px-2"
          style={{ paddingRight: 'var(--scrollbar-width)' }}
        >
          Tracks
        </div>
      </div>

      <div class="min-h-0 flex-1 grid grid-cols-[1fr_1fr_1fr]">
        <div class="min-h-0">
          <VirtualList
            itemHeight={ROW_HEIGHT}
            numItems={store.artistView.artists.total}
            scrollToRow={store.artistView.artistIdx}
            onRangeChange={$((startIndex, endIndex) => artistPager.value?.ensureRange(startIndex, endIndex))}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const artist = aggregateItemAt(store.artistView.artists, index)
              if (!artist) return <div class="bg-gray-900" style={{ ...style, height: `${ROW_HEIGHT}px` }} />
              const highlighted = store.artistView.artistIdx === index
              const isCursor = store.artistView.cursorCol === 0 && highlighted

              return (
                <button
                  key={artist.value}
                  onDblClick$={() => playSelection({ artist: artist.value, sort: 'default' })}
                  onClick$={() => {
                    store.artistView.artistIdx = index
                    store.artistView.cursorCol = 0
                  }}
                  style={{ ...style, height: ROW_HEIGHT + 'px' }}
                  class={`flex items-center justify-between gap-2 px-2 truncate w-full text-sm hover:bg-[rgba(0,0,0,.15)]
                  ${highlighted && 'bg-gray-800'}
                  ${isCursor && '!bg-gray-700'}`}
                >
                  <span class="truncate">{artist.name}</span>
                  <span class="text-xs text-slate-500">{artist.trackCount}</span>
                </button>
              )
            })}
          />
        </div>

        <div class="min-h-0 border-l border-gray-700">
          <VirtualList
            itemHeight={ROW_HEIGHT}
            numItems={store.artistView.albums.total}
            scrollToRow={store.artistView.albumIdx}
            onRangeChange={$((startIndex, endIndex) => albumPager.value?.ensureRange(startIndex, endIndex))}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const album = aggregateItemAt(store.artistView.albums, index)
              if (!album) return <div class="bg-gray-900" style={{ ...style, height: `${ROW_HEIGHT}px` }} />
              const highlighted = store.artistView.albumIdx === index
              const isCursor = store.artistView.cursorCol === 1 && highlighted

              return (
                <button
                  key={`${album.artistValue}\0${album.value}`}
                  onDblClick$={() => playSelection({ album: album.value, artist: album.artistValue, sort: 'track' })}
                  onClick$={() => {
                    store.artistView.albumIdx = index
                    store.artistView.cursorCol = 1
                  }}
                  style={{ ...style, height: ROW_HEIGHT + 'px' }}
                  class={`flex items-center justify-between gap-2 px-2 truncate w-full text-sm hover:bg-[rgba(0,0,0,.15)]
                  ${highlighted && 'bg-gray-800'}
                  ${isCursor && '!bg-gray-700'}`}
                >
                  <span class="truncate">{album.name}</span>
                  <span class="text-xs text-slate-500">{album.trackCount}</span>
                </button>
              )
            })}
          />
        </div>

        <div class="min-h-0 border-l border-gray-700">
          <VirtualList
            itemHeight={ROW_HEIGHT}
            numItems={store.artistView.tracks.total}
            scrollToRow={store.artistView.trackIdx}
            onRangeChange={$((startIndex, endIndex) => trackPager.value?.ensureRange(startIndex, endIndex))}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const song = librarySongAt(store.artistView.tracks, index)
              if (!song) return <div class="bg-gray-900" style={{ ...style, height: `${ROW_HEIGHT}px` }} />
              const highlighted = store.artistView.trackIdx === index
              const isCursor = store.artistView.cursorCol === 2 && highlighted
              const isPlaying = store.player.currSong?.id === song.id
              const album = aggregateItemAt(store.artistView.albums, store.artistView.albumIdx)

              return (
                <button
                  key={song.id}
                  onDblClick$={() => {
                    if (album) playSelection({ album: album.value, artist: album.artistValue, sort: 'track' }, song)
                  }}
                  onClick$={() => {
                    store.artistView.trackIdx = index
                    store.artistView.cursorCol = 2
                  }}
                  style={{ ...style, height: ROW_HEIGHT + 'px' }}
                  class={`flex items-center justify-between px-2 truncate w-full text-sm hover:bg-[rgba(0,0,0,.15)]
                  ${highlighted && 'bg-gray-800'}
                  ${isCursor && '!bg-gray-700'}`}
                >
                  {song.title || '-'}
                  <SoundBars show={isPlaying} />
                </button>
              )
            })}
          />
        </div>
      </div>
    </section>
  )
})

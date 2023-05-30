import { component$, useComputed$, useContext, useStore, useTask$, useVisibleTask$ } from '@builder.io/qwik'
import { StoreActionsContext, StoreContext } from '../layout'
import VirtualList from '~/components/Shared/VirtualList'
import { appWindow } from '@tauri-apps/api/window'
import type { Album, ListItemStyle, Song } from '~/App'
import { ArrowDown } from '~/components/svg/ArrowDown'
import { ArrowUp } from '~/components/svg/ArrowUp'
import { SoundBars } from '~/components/Shared/SoundBars'

interface AlbumsProps {}

const RowHeight = 30

export default component$<AlbumsProps>(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const state = useStore({
    virtualListHeight: 0,
    windowHeight: 0,
  })

  useComputed$(() => {
    const artistMap: { [artist: string]: { [album: string]: Song[] } } = {}

    const setNestedKey = (obj: any, path: string[], song: Song) => {
      const len = path.length
      for (let i = 0; i < len - 1; i++) {
        const elem = path[i]
        if (!obj[elem]) obj[elem] = {}
        obj = obj[elem]
      }

      obj[path[len - 1]] = song
    }

    for (const song of store.filteredSongs) {
      setNestedKey(artistMap, [song.artist || '-', song.album || '-', song.title || '-'], song)
    }

    const artistArr = Object.entries(artistMap).map(([artist, album]) => ({
      name: artist,
      albums: Object.entries(album).map(([album, songs]) => ({
        title: album,
        tracks: Object.values(songs),
      })),
    }))

    store.artistView.artists = artistArr
  })

  useTask$(({ track }) => {
    const artists = track(() => store.artistView.artists)
    const artistIdx = track(() => store.artistView.artistIdx)
    store.artistView.albums = artists[artistIdx]?.albums || []
  })
  useTask$(({ track }) => {
    const albums = track(() => store.artistView.albums)
    const albumIdx = track(() => store.artistView.albumIdx)
    store.artistView.tracks = albums[albumIdx]?.tracks || []
  })

  useVisibleTask$(async () => {
    const sizeVirtualList = async () => {
      const factor = await appWindow.scaleFactor()
      const { height } = (await appWindow.innerSize()).toLogical(factor)
      state.virtualListHeight = height - RowHeight * 2 // 2 rows (col titles + footer)
      state.windowHeight = height
    }
    sizeVirtualList()
    const unlistenResize = await appWindow.onResized(sizeVirtualList)
    return () => unlistenResize()
  })

  return (
    <section class="w-full flex flex-col flex-1">
      <div
        class="w-full text-sm grid grid-cols-[1fr_1fr_1fr] text-left items-center border-b border-gray-700"
        style={{ height: RowHeight + 'px', paddingRight: 'var(--scrollbar-width)' }}
      >
        <button
          class="truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'artist-desc' ? 'artist-asc' : 'artist-desc')}
        >
          Artists
          {store.sorting === 'artist-desc' && <ArrowDown />}
          {store.sorting === 'artist-asc' && <ArrowUp />}
          <span class="h-full w-[1px] bg-gray-700 absolute right-0 cursor-pointer" />
        </button>
        <button
          class="truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'album-desc' ? 'album-asc' : 'album-desc')}
        >
          Albums
          {store.sorting === 'album-desc' && <ArrowDown />}
          {store.sorting === 'album-asc' && <ArrowUp />}
          <span class="h-full w-[1px] bg-gray-700 absolute right-0 cursor-pointer" />
        </button>
        <button
          class="truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'title-desc' ? 'title-asc' : 'title-desc')}
        >
          Tracks
          {store.sorting === 'title-desc' && <ArrowDown />}
          {store.sorting === 'title-asc' && <ArrowUp />}
        </button>
      </div>

      {/* Artists */}
      <div class="grid grid-cols-[1fr_1fr_1fr]">
        <div class="h-full" style={{ maxHeight: state.virtualListHeight + 'px' }}>
          <VirtualList
            numItems={store.artistView.artists.length}
            itemHeight={RowHeight}
            windowHeight={state.virtualListHeight || 0}
            scrollToRow={store.artistView.artistIdx}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const artist = store.artistView.artists[index]

              const highlighted = store.artistView.artistIdx === index
              const isCursor = store.artistView.cursorCol === 0 && highlighted

              return (
                <button
                  key={artist.name}
                  onDblClick$={() => {
                    // Reset album index
                    store.artistView.albumIdx = 0
                    // Get all songs from all playlists
                    store.playlist = store.artistView.albums.reduce(
                      (result: Song[], current: Album) => (result = [...result, ...current.tracks]),
                      []
                    )
                    storeActions.playSong(store.playlist[0], 0)
                  }}
                  onClick$={() => (store.artistView.artistIdx = index) && (store.artistView.cursorCol = 0)}
                  style={{ ...style, height: RowHeight + 'px' }}
                  class={`border-t first:border-t-0 border-r flex items-center px-2 truncate border-gray-800 w-full text-sm hover:bg-[rgba(0,0,0,.15)]  
                  ${highlighted && 'bg-gray-800'}
                  ${isCursor && '!bg-gray-700'}`}
                >
                  {artist.name}
                </button>
              )
            })}
          />
        </div>

        {/* Albums */}
        <div class="h-full" style={{ maxHeight: state.virtualListHeight + 'px' }}>
          <VirtualList
            numItems={store.artistView.albums.length}
            itemHeight={RowHeight}
            windowHeight={state.virtualListHeight || 0}
            scrollToRow={store.artistView.albumIdx}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const album = store.artistView.albums[index]

              const highlighted = store.artistView.albumIdx === index
              const isCursor = store.artistView.cursorCol === 1 && highlighted

              return (
                <button
                  key={album.title}
                  onDblClick$={() => {
                    store.playlist = album.tracks
                    storeActions.playSong(album.tracks[0], 0)
                  }}
                  onClick$={() => (store.artistView.albumIdx = index) && (store.artistView.cursorCol = 1)}
                  style={{ ...style, height: RowHeight + 'px' }}
                  class={`border-t first:border-t-0 border-r flex items-center px-2 truncate border-gray-800 w-full text-sm hover:bg-[rgba(0,0,0,.15)]  
                  ${highlighted && 'bg-gray-800'}
                  ${isCursor && '!bg-gray-700'}`}
                >
                  {album.title}
                </button>
              )
            })}
          />
        </div>

        {/* Songs */}
        <div class="h-full" style={{ maxHeight: state.virtualListHeight + 'px' }}>
          <VirtualList
            numItems={store.artistView.tracks?.length}
            itemHeight={RowHeight}
            windowHeight={state.virtualListHeight || 0}
            scrollToRow={store.artistView.trackIdx}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const song = store.artistView.tracks[index]

              const highlighted = store.artistView.trackIdx === index
              const isCursor = store.artistView.cursorCol === 2 && highlighted
              const selected = store.player.currSong?.id === song.id

              return (
                <button
                  key={song.title}
                  onDblClick$={() => {
                    store.playlist = store.artistView.tracks
                    storeActions.playSong(song, index)
                  }}
                  onClick$={() => (store.artistView.trackIdx = index) && (store.artistView.cursorCol = 2)}
                  style={{ ...style, height: RowHeight + 'px' }}
                  class={`border-t first:border-t-0 border-r flex items-center justify-between px-2 truncate border-gray-800 w-full text-sm hover:bg-[rgba(0,0,0,.15)]  
                  ${highlighted && 'bg-gray-800'}
                  ${isCursor && '!bg-gray-700'}`}
                >
                  {song.title || '-'}

                  <SoundBars show={selected} />
                </button>
              )
            })}
          />
        </div>
      </div>
    </section>
  )
})

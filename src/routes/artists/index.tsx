import { component$, useComputed$, useContext, useTask$ } from '@builder.io/qwik'
import { StoreActionsContext, StoreContext } from '../layout'
import VirtualList from '~/components/Shared/VirtualList'
import type { ListItemStyle, Song } from '~/App'
import { ArrowDown } from '~/components/svg/ArrowDown'
import { ArrowUp } from '~/components/svg/ArrowUp'
import { SoundBars } from '~/components/Shared/SoundBars'
import { useLegacyCatalog } from '~/services/library-client'

const RowHeight = 30

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  useLegacyCatalog(store)

  const artists = useComputed$(() => {
    const artistMap = new Map<string, Map<string, Song[]>>()

    for (const song of store.filteredSongs) {
      const artistName = song.artist || '-'
      const albumName = song.album || '-'
      let albums = artistMap.get(artistName)
      if (!albums) {
        albums = new Map()
        artistMap.set(artistName, albums)
      }

      const tracks = albums.get(albumName)
      if (tracks) tracks.push(song)
      else albums.set(albumName, [song])
    }

    return Array.from(artistMap, ([artist, albums]) => ({
      name: artist,
      albums: Array.from(albums, ([album, songs]) => ({
        title: album,
        tracks: songs,
      })),
    }))
  })

  useTask$(({ track }) => {
    store.artistView.artists = track(() => artists.value)
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

  return (
    <section class="min-h-0 w-full flex flex-col flex-1">
      <div
        class="w-full text-sm grid grid-cols-[1fr_1fr_1fr] text-left items-center border-b border-gray-700"
        style={{ height: RowHeight + 'px' }}
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
        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          style={{ paddingRight: 'var(--scrollbar-width)' }}
        >
          Albums
        </button>
        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          style={{ paddingRight: 'var(--scrollbar-width)' }}
        >
          Tracks
        </button>
      </div>

      <div class="min-h-0 flex-1 grid grid-cols-[1fr_1fr_1fr]">
        <div class="min-h-0">
          <VirtualList
            itemHeight={RowHeight}
            numItems={store.artistView.artists.length}
            scrollToRow={store.artistView.artistIdx}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const artist = store.artistView.artists[index]

              const highlighted = store.artistView.artistIdx === index
              const isCursor = store.artistView.cursorCol === 0 && highlighted

              return (
                <button
                  key={artist.name}
                  onDblClick$={() => {
                    store.artistView.albumIdx = 0
                    store.playlist = store.artistView.albums.flatMap((album) => album.tracks)
                    const firstSong = store.playlist[0]
                    if (firstSong) storeActions.playSong(firstSong, 0)
                  }}
                  onClick$={() => {
                    store.artistView.artistIdx = index
                    store.artistView.cursorCol = 0
                  }}
                  style={{ ...style, height: RowHeight + 'px' }}
                  class={`flex items-center px-2 truncate w-full text-sm hover:bg-[rgba(0,0,0,.15)]
                  ${highlighted && 'bg-gray-800'}
                  ${isCursor && '!bg-gray-700'}`}
                >
                  {artist.name}
                </button>
              )
            })}
          />
        </div>

        <div class="min-h-0 border-l border-gray-700">
          <VirtualList
            itemHeight={RowHeight}
            numItems={store.artistView.albums.length}
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
                    const firstSong = album.tracks[0]
                    if (firstSong) storeActions.playSong(firstSong, 0)
                  }}
                  onClick$={() => {
                    store.artistView.albumIdx = index
                    store.artistView.cursorCol = 1
                  }}
                  style={{ ...style, height: RowHeight + 'px' }}
                  class={`flex items-center px-2 truncate w-full text-sm hover:bg-[rgba(0,0,0,.15)]
                  ${highlighted && 'bg-gray-800'}
                  ${isCursor && '!bg-gray-700'}`}
                >
                  {album.title}
                </button>
              )
            })}
          />
        </div>

        <div class="min-h-0 border-l border-gray-700">
          <VirtualList
            itemHeight={RowHeight}
            numItems={store.artistView.tracks?.length}
            scrollToRow={store.artistView.trackIdx}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const song = store.artistView.tracks[index]

              const highlighted = store.artistView.trackIdx === index
              const isCursor = store.artistView.cursorCol === 2 && highlighted
              const isPlaying = store.player.currSong?.id === song.id

              return (
                <button
                  key={song.title}
                  onDblClick$={() => {
                    store.playlist = store.artistView.tracks
                    storeActions.playSong(song, index)
                  }}
                  onClick$={() => {
                    store.artistView.trackIdx = index
                    store.artistView.cursorCol = 2
                  }}
                  style={{ ...style, height: RowHeight + 'px' }}
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

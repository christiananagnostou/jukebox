import { $, component$, useContext } from '@builder.io/qwik'

import type { Song } from '~/App'
import { libraryPlaybackAt } from '~/services/library-client'
import { updateFavoriteRating } from '~/services/library-db'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { SoundBars } from '../Shared/SoundBars'
import { Star0 } from '../svg/Star0'
import { Star1 } from '../svg/Star1'
import { Star2 } from '../svg/Star2'

function formatDateAdded(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return `${date.getMonth() + 1}-${date.getDate()}-${String(date.getFullYear()).slice(-2)}`
}

export interface LibraryRowProps {
  index: number
  song: Song
  style: Record<string, string | number | undefined>
  classes: string
}

export const LibraryRow = component$<LibraryRowProps>(({ index, song, style, classes }) => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const isPlaying = store.player.currSong?.id === song.id

  const onClick = $(() => {
    store.libraryView.cursorIdx = index
  })

  const onDblClick = $(() => {
    const playback = libraryPlaybackAt(store.libraryCatalog, index)
    if (!playback) return
    store.playlist = playback.playlist
    storeActions.playSong(playback.song, playback.playlistIndex)
  })

  const handleFavorClick = $(async (rating: Song['favorRating']) => {
    await updateFavoriteRating(song.id, rating)
    song.favorRating = rating
    if (store.legacyCatalogLoaded) {
      const legacySong = store.legacyCatalog.find((item) => item.id === song.id)
      if (legacySong) legacySong.favorRating = rating
    }
    store.libraryCatalog.refreshKey += 1
  })

  const nextRating = ((song.favorRating + 1) % 3) as Song['favorRating']

  return (
    <div
      key={song.title}
      onDblClick$={onDblClick}
      onClick$={onClick}
      style={style}
      class={
        classes +
        ` hover:bg-[rgba(0,0,0,.15)]
        ${isPlaying && '!bg-gray-700'}`
      }
    >
      <SoundBars show={isPlaying} />

      <span class="truncate pl-1 relative">{song.title}</span>

      <span class="truncate pl-2">{song.artist}</span>

      <span class="truncate pl-2">{song.album}</span>

      <span class="truncate pl-2">{song.trackNumber}</span>

      <span class="truncate pl-2">{song.sampleRate}</span>

      <span class="truncate pl-2">{song.date}</span>

      <span class="truncate pl-2">{formatDateAdded(song.dateAdded)}</span>

      <span class="truncate pl-2 flex align-center">
        <button
          aria-label={`Set favorite rating to ${nextRating}`}
          title={`Favorite rating: ${song.favorRating}`}
          onClick$={(event) => {
            event.stopPropagation()
            handleFavorClick(nextRating)
          }}
          onDblClick$={(event) => event.stopPropagation()}
        >
          {song.favorRating === 0 && <Star0 />}
          {song.favorRating === 1 && <Star1 />}
          {song.favorRating === 2 && <Star2 />}
        </button>
      </span>
    </div>
  )
})

import { $, component$, useContext } from '@builder.io/qwik'
import type { Song } from '~/App'
import { SoundBars } from '../Shared/SoundBars'
import { Star0 } from '../svg/Star0'
import { Star1 } from '../svg/Star1'
import { Star2 } from '../svg/Star2'
import Database from '@tauri-apps/plugin-sql'
import { LIBRARY_DB, StoreActionsContext, StoreContext } from '~/routes/layout'
import dayjs from 'dayjs'

export interface LibraryRowProps {
  index: number
  style: Record<string, string | number | undefined>
  classes: string
}

export const LibraryRow = component$<LibraryRowProps>(({ index, style, classes }) => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const song = store.filteredSongs[index]
  const isPlaying = store.player.currSong?.id === song.id

  const onClick = $(() => {
    store.libraryView.cursorIdx = index
  })

  const onDblClick = $(() => {
    store.playlist = store.filteredSongs
    storeActions.playSong(song, index)
  })

  // Update favor rating
  const handleFavorClick = $(async (rating: Song['favorRating']) => {
    song.favorRating = rating
    const db = await Database.load(LIBRARY_DB)
    db.execute('UPDATE songs SET favorRating = $1 WHERE id = $2', [rating, song.id])
  })

  const ratingsWithStars: { rating: Song['favorRating']; star: any }[] = [
    { rating: 0, star: <Star0 /> },
    { rating: 1, star: <Star1 /> },
    { rating: 2, star: <Star2 /> },
  ]

  return (
    <button
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

      <span class="truncate pl-2">{dayjs(song.dateAdded).format('M-D-YY')}</span>

      <span class="truncate pl-2 flex align-center">
        {ratingsWithStars.map(({ rating, star }, i) => (
          <button
            key={rating}
            onClick$={() => handleFavorClick(ratingsWithStars[(i + 1) % 3].rating)}
            onDoubleClick$={(e: MouseEvent) => e.stopPropagation()}
          >
            {song.favorRating === rating && star}
          </button>
        ))}
      </span>
    </button>
  )
})

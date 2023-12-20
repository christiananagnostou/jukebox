import { $, component$, type QRL } from '@builder.io/qwik'
import type { Song } from '~/App'
import { SoundBars } from '../Shared/SoundBars'
import { Star0 } from '../svg/Star0'
import { Star1 } from '../svg/Star1'
import { Star2 } from '../svg/Star2'

export interface LibraryRowProps {
  song: Song
  onDblClick: QRL<(event: MouseEvent, element: HTMLButtonElement) => any>
  onClick: QRL<(event: MouseEvent, element: HTMLButtonElement) => any>
  style: Record<string, string | number | undefined>

  isPlaying: boolean
  classes: string
}

export const LibraryRow = component$<LibraryRowProps>(({ song, onDblClick, onClick, style,isPlaying, classes }) => {
  return (
    <button
      key={song.title}
      onDblClick$={$((e, el) => onDblClick(e, el))}
      onClick$={$((e, el) => onClick(e, el))}
      style={style}
class={classes}>
  <SoundBars show={isPlaying} />  
      <span class="truncate pl-1 relative">{song.title}</span>
      <span class="truncate pl-2">{song.artist}</span>
      <span class="truncate pl-2">{song.album}</span>
      <span class="truncate pl-2">{song.trackNumber}</span>
      <span class="truncate pl-2">{song.sampleRate}</span>
      <span class="truncate pl-2">{song.date}</span>

      <span class="truncate pl-2">
        {song.favorRating === 0 && (
          <button onClick$={() => (song.favorRating = 1)}>
            <Star0 />
          </button>
        )}
        {song.favorRating === 1 && (
          <button onClick$={() => (song.favorRating = 2)}>
            <Star1 />
          </button>
        )}
        {song.favorRating === 2 && (
          <button onClick$={() => (song.favorRating = 0)}>
            <Star2 />
          </button>
        )}
      </span>
    </button>
  )
})

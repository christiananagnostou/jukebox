import { $, type QwikMouseEvent, component$, type QRL } from '@builder.io/qwik'
import type { Song } from '~/App'
import { SoundBars } from '../Shared/SoundBars'
import { Star0 } from '../svg/Star0'
import { Star1 } from '../svg/Star1'
import { Star2 } from '../svg/Star2'

export interface LibraryRowProps {
  song: Song
  onDblClick: QRL<(event: QwikMouseEvent<HTMLButtonElement, MouseEvent>, element: HTMLButtonElement) => any>
  onClick: QRL<(event: QwikMouseEvent<HTMLButtonElement, MouseEvent>, element: HTMLButtonElement) => any>
  style: Record<string, string | number | undefined>
  isCursor: boolean
  isPlaying: boolean
}

export const LibraryRow = component$<LibraryRowProps>(({ song, onDblClick, onClick, style, isCursor, isPlaying }) => {
  return (
    <button
      key={song.title}
      onDblClick$={$((e, el) => onDblClick(e, el))}
      onClick$={$((e, el) => onClick(e, el))}
      style={style}
      class={`w-full text-sm grid grid-cols-[22px_1fr_1fr_1fr_120px_120px_120px_70px] text-left items-center hover:bg-[rgba(0,0,0,.15)] 
      ${isCursor && '!bg-gray-800'}
      ${isPlaying && '!bg-gray-700'}`}
    >
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

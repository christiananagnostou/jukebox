import { type QwikMouseEvent, component$ } from '@builder.io/qwik'
import type { Song } from '~/App'
import { SoundBars } from '../Shared/SoundBars'

export interface LibraryRowProps {
  song: Song
  onDblClick: (event: QwikMouseEvent<HTMLButtonElement, MouseEvent>, element: HTMLButtonElement) => any
  onClick: (event: QwikMouseEvent<HTMLButtonElement, MouseEvent>, element: HTMLButtonElement) => any
  style: Record<string, string | number | undefined>
  isCursor: boolean
  isPlaying: boolean
}

export const LibraryRow = component$<LibraryRowProps>(({ song, onDblClick, onClick, style, isCursor, isPlaying }) => {
  return (
    <button
      key={song.title}
      onDblClick$={onDblClick}
      onClick$={onClick}
      style={style}
      class={`border-t first:border-t-0 border-r border-gray-800 w-full text-sm grid grid-cols-[22px_1fr_1fr_1fr] text-left items-center hover:bg-[rgba(0,0,0,.15)] 
      ${isCursor && '!bg-gray-800'}
      ${isPlaying && '!bg-gray-700'}`}
    >
      <SoundBars show={isPlaying} />

      <span class="truncate pl-1">{song.title}</span>
      <span class="truncate pl-2">{song.artist}</span>
      <span class="truncate pl-2">{song.album}</span>
    </button>
  )
})

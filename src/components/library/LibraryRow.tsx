import { type QwikMouseEvent, component$ } from '@builder.io/qwik'
import type { Song } from '~/App'

export interface LibraryRowProps {
  song: Song
  onDblClick: (event: QwikMouseEvent<HTMLButtonElement, MouseEvent>, element: HTMLButtonElement) => any
  onClick: (event: QwikMouseEvent<HTMLButtonElement, MouseEvent>, element: HTMLButtonElement) => any
  style: Record<string, string | number | undefined>
  highlighted: boolean
  selected: boolean
}

export const LibraryRow = component$<LibraryRowProps>(({ song, onDblClick, onClick, style, highlighted, selected }) => {
  return (
    <button
      key={song.title}
      onDblClick$={onDblClick}
      onClick$={onClick}
      style={style}
      class={`border-t first:border-t-0 border-r border-gray-800 w-full text-sm grid grid-cols-[22px_1fr_1fr_1fr] text-left items-center hover:bg-[rgba(0,0,0,.15)] 
      ${highlighted && '!bg-gray-800'}
      ${selected && '!bg-gray-700'}`}
    >
      <div class="sound-wave pl-2">
        {selected && (
          <>
            <i class="bar"></i>
            <i class="bar"></i>
            <i class="bar"></i>
            <i class="bar"></i>
          </>
        )}
      </div>

      <span class="truncate pl-1">{song.title}</span>
      <span class="truncate pl-2">{song.artist}</span>
      <span class="truncate pl-2">{song.album}</span>
    </button>
  )
})

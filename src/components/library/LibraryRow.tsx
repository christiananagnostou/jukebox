import { type QwikMouseEvent, component$ } from '@builder.io/qwik'
import type { Song } from '~/App'

export interface LibraryRowProps {
  song: Song
  onDblClick: (event: QwikMouseEvent<HTMLButtonElement, MouseEvent>, element: HTMLButtonElement) => any
  style: Record<string, string | number | undefined>
  highlighted: boolean
  selected: boolean
}

export const LibraryRow = component$<LibraryRowProps>(({ song, onDblClick, style, highlighted, selected }) => {
  return (
    <button
      key={song.title}
      onDblClick$={onDblClick}
      style={style}
      class={`px-1 border-t first:border-t-0 border-r border-gray-800 w-full text-sm grid grid-cols-[22px_1fr_1fr_1fr] gap-1 text-left items-center hover:bg-[rgba(0,0,0,.15)] 
      ${highlighted && '!bg-gray-800'}
      ${selected && '!bg-gray-700'}`}
    >
      <div class="sound-wave">
        {selected && (
          <>
            <i class="bar"></i>
            <i class="bar"></i>
            <i class="bar"></i>
            <i class="bar"></i>
          </>
        )}
      </div>

      <span class="truncate">{song.title}</span>
      <span class="truncate">{song.artist}</span>
      <span class="truncate">{song.album}</span>
    </button>
  )
})

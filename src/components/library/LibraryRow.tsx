import { type QwikMouseEvent, component$ } from '@builder.io/qwik'
import type { Song } from '~/App'

export interface LibraryRowProps {
  song: Song
  onDblClick: (event: QwikMouseEvent<HTMLButtonElement, MouseEvent>, element: HTMLButtonElement) => any
  style: Record<string, string | number | undefined>
  classes: string
}

export const LibraryRow = component$<LibraryRowProps>(({ song, onDblClick, style, classes }) => {
  return (
    <button
      key={song.title}
      onDblClick$={onDblClick}
      style={style}
      class={
        'px-2 border-t first:border-t-0 border-r border-gray-800 w-full text-sm grid grid-cols-4 text-left items-center hover:bg-[rgba(0,0,0,.15)]' +
        classes
      }
    >
      <span class="truncate">{song.title}</span>
      <span class="truncate">{song.artist}</span>
      <span class="truncate">{song.album}</span>
    </button>
  )
})

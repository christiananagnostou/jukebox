import { component$, useContext } from '@builder.io/qwik'
import type { Song } from '~/App'
import { StoreContext } from '~/routes/layout'

interface QueueProps {}

export default component$<QueueProps>(() => {
  const store = useContext(StoreContext)

  const getCircularWindow = (arr: Song[], start: number) => {
    const end = (start + 5) % arr.length
    return start <= end ? arr.slice(start, end) : [...arr.slice(start), ...arr.slice(0, end)]
  }

  const next5Displayed = getCircularWindow(store.playlist, store.player.currSongIndex + 1)

  return (
    <div class="p-2">
      <span class="text-gray-400 text-xs pb-1 block">Queue</span>

      <ol>
        {(store.queue.length ? store.queue : next5Displayed).map((song) => (
          <li class="pb-3" key={'queued-song-' + song.id}>
            <span class="block truncate">{song.title}</span>
            <span class="text-xs truncate">{song.artist}</span>
          </li>
        ))}
      </ol>
    </div>
  )
})

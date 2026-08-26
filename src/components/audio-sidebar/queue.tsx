import { component$, useContext } from '@builder.io/qwik'
import { StoreContext } from '~/routes/layout'
import { getUpcomingSongs } from '~/utils/Songs'

export default component$(() => {
  const store = useContext(StoreContext)
  const upcomingSongs = getUpcomingSongs(store.playlist, store.player.currSongIndex)

  return (
    <div class="p-2">
      <span class="text-gray-400 text-xs pb-1 block">Queue</span>

      <ol>
        {(store.queue.length ? store.queue : upcomingSongs).map((song) => (
          <li class="pt-1 pb-2" key={'queued-song-' + song.id}>
            <span class="block truncate">{song.title}</span>
            <span class="text-xs truncate text-gray-400">{song.artist}</span>
          </li>
        ))}
      </ol>
    </div>
  )
})

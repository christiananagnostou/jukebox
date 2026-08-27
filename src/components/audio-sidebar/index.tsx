import { component$, useContext } from '@builder.io/qwik'
import { StoreContext } from '~/routes/layout'
import Player from './player'
import Queue from './queue'

export default component$(() => {
  const store = useContext(StoreContext)

  return (
    <aside
      class="app-audio-sidebar border-l border-gray-700 h-screen min-w-0 flex z-20 flex-col text-sm overflow-y-auto overflow-x-hidden"
      data-open={store.player.currSong ? 'true' : 'false'}
    >
      <div class="mt-[29px] border-t border-gray-700 flex flex-col h-full">
        <Player />

        <Queue />
      </div>
    </aside>
  )
})

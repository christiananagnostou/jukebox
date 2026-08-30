import { component$, useContext } from '@builder.io/qwik'
import { StoreContext } from '~/routes/layout'
import Player from './player'
import Queue from './queue'

export default component$(() => {
  const store = useContext(StoreContext)

  return (
    <aside
      class="app-audio-sidebar h-screen min-w-0 flex z-20 flex-col overflow-y-auto overflow-x-hidden border-l border-slate-700/80 bg-[rgba(20,20,28,0.98)] text-sm"
      data-open={store.player.currSong || store.queue.length || store.player.canUndoQueueEdit ? 'true' : 'false'}
    >
      <div class="mt-[29px] flex h-full flex-col border-t border-slate-700/80">
        <Player />

        <Queue />
      </div>
    </aside>
  )
})

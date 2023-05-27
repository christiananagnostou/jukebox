import { component$, useContext } from '@builder.io/qwik'
import { StoreContext } from '~/routes/layout'
import Player from './player'
import Queue from './queue'

interface IndexProps {}

export default component$<IndexProps>(() => {
  const store = useContext(StoreContext)

  return (
    <aside
      class="border-l border-gray-700 fixed top-0 right-0 h-screen flex z-20 flex-col text-sm transition-all overflow-auto"
      style={{
        right: store.player.currSong ? '0' : 'calc(var(--audio-sidebar-width) * -1)',
        width: 'var(--audio-sidebar-width)',
      }}
    >
      <div class="mt-[29px] border-t border-gray-700 flex flex-col h-full">
        <Player />

        <Queue />
      </div>
    </aside>
  )
})

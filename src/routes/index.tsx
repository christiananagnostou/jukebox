import { $, component$, useContext, useSignal, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { type DocumentHead } from '@builder.io/qwik-city'
import { appWindow } from '@tauri-apps/api/window'
import VirtualList from '~/components/Shared/VirtualList'
import type { ListItemStyle } from '~/App'
import { StoreActionsContext, StoreContext } from './layout'
import { ArrowDown } from '~/components/svg/ArrowDown'
import { ArrowUp } from '~/components/svg/ArrowUp'
import { LibraryRow } from '~/components/library/LibraryRow'

const RowHeight = 30

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const virtualListElem = useSignal<Element>()
  const state = useStore({ virtualListHeight: virtualListElem.value?.clientHeight, windowHeight: 0 })

  useVisibleTask$(async () => {
    state.virtualListHeight = virtualListElem.value?.clientHeight
    state.windowHeight = (await appWindow.outerSize()).height

    const unlistenResize = await appWindow.onResized(async ({ payload: size }) => {
      if (!virtualListElem.value) return
      const factor = await appWindow.scaleFactor()
      const logical = size.toLogical(factor)
      state.virtualListHeight = logical.height - RowHeight * 2 // 2 rows plus top bar - 28px
      state.windowHeight = logical.height
    })

    return () => unlistenResize()
  })

  return (
    <div class="w-full flex flex-col flex-1">
      <section class="w-full flex flex-col flex-1">
        <div
          class="px-2 w-full text-sm grid grid-cols-4 items-center text-left border-b border-gray-700"
          style={{ height: RowHeight + 'px' }}
        >
          <button
            class="truncate border-r border-gray-700 h-full flex items-center justify-between px-2"
            onClick$={() => (store.sorting = store.sorting === 'title-desc' ? 'title-asc' : 'title-desc')}
          >
            Title
            {store.sorting === 'title-desc' && <ArrowDown />}
            {store.sorting === 'title-asc' && <ArrowUp />}
          </button>
          <button
            class="truncate border-r border-gray-700 h-full flex items-center justify-between px-2"
            onClick$={() => (store.sorting = store.sorting === 'artist-desc' ? 'artist-asc' : 'artist-desc')}
          >
            Artist
            {store.sorting === 'artist-desc' && <ArrowDown />}
            {store.sorting === 'artist-asc' && <ArrowUp />}
          </button>
          <button
            class="truncate border-r border-gray-700 h-full flex items-center justify-between px-2"
            onClick$={() => (store.sorting = store.sorting === 'album-desc' ? 'album-asc' : 'album-desc')}
          >
            Album
            {store.sorting === 'album-desc' && <ArrowDown />}
            {store.sorting === 'album-asc' && <ArrowUp />}
          </button>
        </div>

        <div ref={virtualListElem} class="flex-1 h-full" style={{ maxHeight: state.virtualListHeight + 'px' }}>
          <VirtualList
            numItems={store.displayedSongs.length}
            itemHeight={RowHeight}
            windowHeight={state.virtualListHeight || 0}
            scrollToRow={store.highlightedIndex}
            renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
              const song = store.displayedSongs[index]
              return (
                <LibraryRow
                  song={song}
                  onDblClick={$(() => storeActions.playSong(song, index))}
                  style={{ ...style, height: RowHeight + 'px' }}
                  highlighted={store.highlightedIndex === index}
                  selected={store.player.currSong?.id === song.id}
                />
              )
            })}
          />
        </div>
      </section>
    </div>
  )
})

export const head: DocumentHead = {
  title: 'Library',
  meta: [
    {
      name: 'description',
      content: 'Qwik site description',
    },
  ],
}

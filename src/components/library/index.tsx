import { $, component$, useContext, useSignal, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { appWindow } from '@tauri-apps/api/window'
import VirtualList from '~/components/Shared/VirtualList'
import type { ListItemStyle } from '~/App'
import { StoreActionsContext, StoreContext } from '../../routes/layout'
import { ArrowDown } from '~/components/svg/ArrowDown'
import { ArrowUp } from '~/components/svg/ArrowUp'
import { LibraryRow } from '~/components/library/LibraryRow'

const RowHeight = 30

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)

  const virtualListElem = useSignal<Element>()
  const state = useStore({
    virtualListHeight: 0,
    windowHeight: 0,
  })

  useVisibleTask$(async () => {
    const sizeVirtualList = async () => {
      const factor = await appWindow.scaleFactor()
      const { height } = (await appWindow.innerSize()).toLogical(factor)
      state.virtualListHeight = height - RowHeight * 2 // 2 rows (col titles + footer)
      state.windowHeight = height
    }
    sizeVirtualList()
    const unlistenResize = await appWindow.onResized(sizeVirtualList)
    return () => unlistenResize()
  })

  return (
    <section class="w-full flex flex-col flex-1">
      <div
        class="w-full text-sm grid grid-cols-[22px_1fr_1fr_1fr] text-left items-center border-b border-gray-700"
        style={{ height: RowHeight + 'px', paddingRight: 'var(--scrollbar-width)' }}
      >
        <span />
        <button
          class="truncate h-full flex items-center justify-between pl-1 pr-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'title-desc' ? 'title-asc' : 'title-desc')}
        >
          Title
          {store.sorting === 'title-desc' && <ArrowDown />}
          {store.sorting === 'title-asc' && <ArrowUp />}
          <span class="h-full w-[1px] bg-gray-700 absolute right-0 cursor-pointer" />
        </button>
        <button
          class="truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'artist-desc' ? 'artist-asc' : 'artist-desc')}
        >
          Artist
          {store.sorting === 'artist-desc' && <ArrowDown />}
          {store.sorting === 'artist-asc' && <ArrowUp />}
          <span class="h-full w-[1px] bg-gray-700 absolute right-0 cursor-pointer" />
        </button>
        <button
          class="truncate h-full flex items-center justify-between px-2 relative"
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
                onClick={$(() => (store.highlightedIndex = index))}
                style={{ ...style, height: RowHeight + 'px' }}
                highlighted={store.highlightedIndex === index}
                selected={store.player.currSong?.id === song.id}
              />
            )
          })}
        />
      </div>
    </section>
  )
})

import { $, component$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
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

  const state = useStore({
    virtualListHeight: 0,
    windowHeight: 0,
  })

  useVisibleTask$(async () => {
    const sizeVirtualList = async () => {
      const factor = await appWindow.scaleFactor()
      const { height } = (await appWindow.innerSize()).toLogical(factor)
      state.virtualListHeight = height - RowHeight * 2 - 28 // 2 rows (col titles + footer)
      state.windowHeight = height
    }
    sizeVirtualList()
    const unlistenResize = await appWindow.onResized(sizeVirtualList)
    return () => unlistenResize()
  })

  return (
    <section class="w-full flex flex-col flex-1">
      <div
        class="w-full text-sm grid grid-cols-[22px_1fr_1fr_1fr_120px_120px_120px_70px] text-left items-center border-b border-gray-700"
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
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'artist-desc' ? 'artist-asc' : 'artist-desc')}
        >
          Artist
          {store.sorting === 'artist-desc' && <ArrowDown />}
          {store.sorting === 'artist-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'album-desc' ? 'album-asc' : 'album-desc')}
        >
          Album
          {store.sorting === 'album-desc' && <ArrowDown />}
          {store.sorting === 'album-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'track-desc' ? 'track-asc' : 'track-desc')}
        >
          Track
          {store.sorting === 'track-desc' && <ArrowDown />}
          {store.sorting === 'track-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'hertz-desc' ? 'hertz-asc' : 'hertz-desc')}
        >
          Hertz
          {store.sorting === 'hertz-desc' && <ArrowDown />}
          {store.sorting === 'hertz-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'date-desc' ? 'date-asc' : 'date-desc')}
        >
          Date
          {store.sorting === 'date-desc' && <ArrowDown />}
          {store.sorting === 'date-asc' && <ArrowUp />}
        </button>

        <button
          class="border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative"
          onClick$={() => (store.sorting = store.sorting === 'fave-desc' ? 'fave-asc' : 'fave-desc')}
        >
          Fave
          {store.sorting === 'fave-desc' && <ArrowDown />}
          {store.sorting === 'fave-asc' && <ArrowUp />}
        </button>
      </div>

      <div class="flex-1 h-full" style={{ maxHeight: state.virtualListHeight + 'px' }}>
        <VirtualList
          numItems={store.filteredSongs.length}
          itemHeight={RowHeight}
          windowHeight={state.virtualListHeight || 0}
          scrollToRow={store.libraryView.cursorIdx}
          renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
            const song = store.filteredSongs[index]
            return (
              <LibraryRow
                key={song.id}
                data-song-index={index}
                song={song}
                onDblClick={$(() => {
                  store.playlist = store.filteredSongs
                  storeActions.playSong(song, index)
                })}
                onClick={$(() => (store.libraryView.cursorIdx = index))}
                style={{ ...style, height: RowHeight + 'px' }}
                isCursor={store.libraryView.cursorIdx === index}
                isPlaying={store.player.currSong?.id === song.id}
              />
            )
          })}
        />
      </div>
    </section>
  )
})

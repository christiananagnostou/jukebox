import { $, component$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { ListItemStyle } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import { LibraryRow } from '~/components/library/LibraryRow'
import { ArrowDown } from '~/components/svg/ArrowDown'
import { ArrowUp } from '~/components/svg/ArrowUp'
import { StoreContext } from '../../routes/layout'

const RowHeight = 30
const RowStyle = 'w-full text-sm grid grid-cols-[22px_1fr_1fr_1fr_120px_120px_120px_120px_70px] text-left items-center'

const ButtonConfigs = [
  { label: 'Title', type: 'title' },
  { label: 'Artist', type: 'artist' },
  { label: 'Album', type: 'album' },
  { label: 'Track', type: 'track' },
  { label: 'Hertz', type: 'hertz' },
  { label: 'Date', type: 'date' },
  { label: 'Date Added', type: 'date-added' },
  { label: 'Fave', type: 'fave' },
]

const SortButton = component$(({ label, type, store }: { label: string; type: string; store: any }) => {
  const handleClick = $(() => {
    store.sorting = store.sorting === `${type}-desc` ? `${type}-asc` : `${type}-desc`
  })

  const isSorting = store.sorting === `${type}-desc` || store.sorting === `${type}-asc`

  return (
    <button
      class={`not-nth-[2]:border-l border-gray-700 truncate h-full flex items-center justify-between px-2 relative ${
        isSorting ? 'text-yellow-500' : ''
      }`}
      onClick$={handleClick}
    >
      {label}
      {store.sorting === `${type}-desc` && <ArrowDown />}
      {store.sorting === `${type}-asc` && <ArrowUp />}
    </button>
  )
})

export default component$(() => {
  const store = useContext(StoreContext)

  const state = useStore({
    virtualListHeight: 0,
    windowHeight: 0,
  })

  useVisibleTask$(async () => {
    const appWindow = getCurrentWebviewWindow()
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
        class={`${RowStyle} border-b border-gray-700`}
        style={{ height: RowHeight + 'px', paddingRight: 'var(--scrollbar-width)' }}
      >
        <span />

        {ButtonConfigs.map((config, index) => (
          <SortButton key={index} label={config.label} type={config.type} store={store} />
        ))}
      </div>

      <div class="flex-1 h-full" style={{ maxHeight: state.virtualListHeight + 'px' }}>
        <VirtualList
          numItems={store.filteredSongs.length}
          itemHeight={RowHeight}
          windowHeight={state.virtualListHeight || 0}
          scrollToRow={store.libraryView.cursorIdx}
          renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
            return (
              <LibraryRow
                key={store.filteredSongs[index].id}
                index={index}
                style={{ ...style, height: RowHeight + 'px' }}
                classes={RowStyle}
              />
            )
          })}
        >
          <div
            class="bg-gray-800 w-full transition-[top] ease-in-out absolute left-0 -z-10"
            style={{
              top: store.libraryView.cursorIdx * RowHeight + 'px',
              height: RowHeight,
            }}
          />
        </VirtualList>
      </div>
    </section>
  )
})

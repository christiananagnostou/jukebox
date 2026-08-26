import { $, component$, useContext } from '@builder.io/qwik'
import type { ListItemStyle, Store } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import { LibraryRow } from '~/components/library/LibraryRow'
import { ArrowDown } from '~/components/svg/ArrowDown'
import { ArrowUp } from '~/components/svg/ArrowUp'
import { StoreContext } from '../../routes/layout'
import { StoreActionsContext } from '../../routes/layout'
import { librarySongAt } from '~/services/library-client'

const RowHeight = 30
const RowStyle = 'w-full text-sm grid grid-cols-[22px_1fr_1fr_1fr_120px_120px_120px_120px_70px] text-left items-center'

type SortField = 'title' | 'artist' | 'album' | 'track' | 'hertz' | 'date' | 'date-added' | 'fave'

const ButtonConfigs: { label: string; type: SortField }[] = [
  { label: 'Title', type: 'title' },
  { label: 'Artist', type: 'artist' },
  { label: 'Album', type: 'album' },
  { label: 'Track', type: 'track' },
  { label: 'Hertz', type: 'hertz' },
  { label: 'Date', type: 'date' },
  { label: 'Date Added', type: 'date-added' },
  { label: 'Fave', type: 'fave' },
]

const SortButton = component$(({ label, type, store }: { label: string; type: SortField; store: Store }) => {
  const handleClick = $(() => {
    const ascending = `${type}-asc` as Store['sorting']
    const descending = `${type}-desc` as Store['sorting']
    store.sorting = store.sorting === ascending ? descending : ascending
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
  const storeActions = useContext(StoreActionsContext)

  return (
    <section class="min-h-0 w-full flex flex-col flex-1">
      <div
        class={`${RowStyle} border-b border-gray-700`}
        style={{ height: RowHeight + 'px', paddingRight: 'var(--scrollbar-width)' }}
      >
        <span />

        {ButtonConfigs.map((config, index) => (
          <SortButton key={index} label={config.label} type={config.type} store={store} />
        ))}
      </div>

      <div class="min-h-0 flex-1">
        <VirtualList
          numItems={store.libraryCatalog.total}
          itemHeight={RowHeight}
          onRangeChange={storeActions.requestLibraryRange}
          scrollToRow={store.libraryView.cursorIdx}
          renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
            const song = librarySongAt(store.libraryCatalog, index)
            if (!song) {
              return <div class={`${RowStyle} text-slate-700`} style={{ ...style, height: RowHeight + 'px' }} />
            }
            return (
              <LibraryRow
                key={song.id}
                index={index}
                song={song}
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

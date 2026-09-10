import {
  $,
  component$,
  useComputed$,
  useContext,
  useContextProvider,
  useSignal,
  useStore,
  useVisibleTask$,
} from '@builder.io/qwik'
import type { ListItemStyle, Store } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import { PageToolbar } from '~/components/Shared/PageToolbar'
import { LibraryRow } from '~/components/library/LibraryRow'
import { ArrowDown } from '~/components/svg/ArrowDown'
import { ArrowUp } from '~/components/svg/ArrowUp'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { librarySongAt } from '~/services/library-client'
import { bindColumnResize } from './column-resize'
import {
  COLUMN_STORAGE_KEY,
  MAX_COLUMN_WIDTH,
  SONG_COLUMNS,
  SongColumnsContext,
  columnLayout,
  columnPreferences,
} from './columns'

const ROW_HEIGHT = 30

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const preferences = useStore(columnPreferences())
  useContextProvider(SongColumnsContext, preferences)
  const root = useSignal<HTMLElement>()
  const preferenceError = useSignal('')
  const visible = useComputed$(() => SONG_COLUMNS.filter((column) => preferences[column.id].visible))
  const save = $(() => {
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(preferences))
      preferenceError.value = ''
    } catch {
      preferenceError.value = 'Column changes apply now, but could not be saved on this device.'
    }
  })

  useVisibleTask$(({ cleanup }) => {
    try {
      Object.assign(preferences, columnPreferences(JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) || 'null')))
    } catch {
      preferenceError.value = 'Saved columns could not be loaded. Default columns are shown.'
    }
    if (!root.value) return
    cleanup(
      bindColumnResize(root.value, (id, width) => {
        preferences[id].width = width
        void save()
      })
    )
  })

  return (
    <section class="songs-library" ref={root} style={columnLayout(preferences)} aria-label="Songs">
      <PageToolbar title="Songs">
        <details class="songs-column-menu">
          <summary>Columns</summary>
          <div class="songs-column-options">
            {SONG_COLUMNS.map((column) => (
              <label key={column.id}>
                <input
                  type="checkbox"
                  checked={preferences[column.id].visible}
                  disabled={column.id === 'title'}
                  onChange$={(_, element) => {
                    preferences[column.id].visible = element.checked
                    if (!element.checked && store.sorting.startsWith(`${column.id}-`)) store.sorting = 'default'
                    void save()
                  }}
                />
                {column.label}
              </label>
            ))}
            <button
              type="button"
              onClick$={() => {
                Object.assign(preferences, columnPreferences())
                if (!SONG_COLUMNS.some((column) => column.visible && store.sorting.startsWith(`${column.id}-`)))
                  store.sorting = 'default'
                void save()
              }}
            >
              Reset columns
            </button>
          </div>
        </details>
      </PageToolbar>
      {preferenceError.value && (
        <p role="status" class="songs-preference-error">
          {preferenceError.value}
        </p>
      )}
      <div class="songs-horizontal-scroll">
        <div class="songs-table" role="table" aria-label="Music library" aria-rowcount={store.libraryCatalog.total + 1}>
          <div class="songs-grid songs-header" role="row" aria-rowindex={1} stoppropagation:keydown>
            <span role="columnheader" aria-label="Playback" />
            {visible.value.map((column) => (
              <div
                key={column.id}
                class="songs-column-heading"
                role="columnheader"
                aria-sort={
                  store.sorting === `${column.id}-asc`
                    ? 'ascending'
                    : store.sorting === `${column.id}-desc`
                      ? 'descending'
                      : 'none'
                }
              >
                {column.id === 'duration' ? (
                  <span class="songs-column-label">{column.label}</span>
                ) : (
                  <button
                    type="button"
                    class="songs-column-label"
                    onClick$={() => {
                      const ascending = `${column.id}-asc` as Store['sorting']
                      store.sorting =
                        store.sorting === ascending ? (`${column.id}-desc` as Store['sorting']) : ascending
                    }}
                  >
                    <span>{column.label}</span>
                    {store.sorting === `${column.id}-desc` && <ArrowDown />}
                    {store.sorting === `${column.id}-asc` && <ArrowUp />}
                  </button>
                )}
                <span
                  role="separator"
                  tabIndex={0}
                  aria-orientation="vertical"
                  aria-label={`Resize ${column.label} column`}
                  aria-valuemin={column.min}
                  aria-valuemax={MAX_COLUMN_WIDTH}
                  aria-valuenow={preferences[column.id].width}
                  data-column-resize={column.id}
                  class="songs-column-resize"
                  title="Drag to resize. Arrow keys adjust width. Double-click to reset."
                />
              </div>
            ))}
          </div>
          <div class="min-h-0 flex-1" role="rowgroup">
            <VirtualList
              numItems={store.libraryCatalog.total}
              itemHeight={ROW_HEIGHT}
              onRangeChange={storeActions.requestLibraryRange}
              scrollToRow={store.libraryView.cursorIdx}
              renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
                const song = librarySongAt(store.libraryCatalog, index)
                if (!song) return <div class="songs-grid" style={{ ...style, height: `${ROW_HEIGHT}px` }} />
                return (
                  <LibraryRow
                    key={song.id}
                    index={index}
                    song={song}
                    style={{ ...style, height: `${ROW_HEIGHT}px` }}
                    classes="songs-grid songs-row"
                  />
                )
              })}
            />
          </div>
        </div>
      </div>
      {store.libraryCatalog.total === 0 && store.libraryCatalog.status === 'ready' && (
        <p class="songs-empty">
          {store.searchTerm ? 'No songs match your search.' : 'Import music to start your library.'}
        </p>
      )}
    </section>
  )
})

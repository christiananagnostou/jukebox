import {
  $,
  component$,
  noSerialize,
  useContext,
  useSignal,
  useStore,
  useTask$,
  useVisibleTask$,
  type NoSerialize,
} from '@builder.io/qwik'

import type { ListItemStyle } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import {
  builtInCollectionItemAt,
  builtInCollectionPlaybackAt,
  type BuiltInCollectionCatalogState,
  type BuiltInCollectionKind,
  BuiltInCollectionPager,
} from '~/services/library-client'
import { getErrorMessage } from '~/utils/Errors'
import { StoreActionsContext } from '~/routes/layout'
import { builtInCollectionDefinition, formatLastPlayed } from './built-in-collections'

const ROW_HEIGHT = 52
const GRID_CLASS = 'grid grid-cols-[48px_minmax(0,1.2fr)_minmax(0,.8fr)_minmax(0,.8fr)_90px_170px]'

function collectionState(): BuiltInCollectionCatalogState {
  return { error: '', pages: {}, revision: '', status: 'loading', total: 0 }
}

export default component$((props: { kind: BuiltInCollectionKind }) => {
  const storeActions = useContext(StoreActionsContext)
  const catalog = useStore(collectionState())
  const pager = useSignal<NoSerialize<BuiltInCollectionPager>>()
  const state = useStore({ playbackError: '' })
  const definition = builtInCollectionDefinition(props.kind)

  useVisibleTask$(({ cleanup }) => {
    const controller = new BuiltInCollectionPager(catalog)
    pager.value = noSerialize(controller)
    void controller.reset(props.kind)
    cleanup(() => {
      controller.dispose()
      pager.value = undefined
    })
  })

  useTask$(({ track }) => {
    const selectedKind = track(() => props.kind)
    state.playbackError = ''
    void pager.value?.reset(selectedKind)
  })

  const playItem = $(async (index: number) => {
    const playback = builtInCollectionPlaybackAt(catalog, index)
    if (!playback) return
    state.playbackError = ''
    try {
      await storeActions.playTracks(playback.playlist, playback.playlistIndex, {
        kind: 'collection',
        label: definition.label,
      })
    } catch (error) {
      state.playbackError = getErrorMessage(error)
    }
  })

  return (
    <section class="flex min-h-0 flex-1 flex-col" aria-label={definition.label}>
      <header class="border-b border-gray-700 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-xl">{definition.label}</h2>
            <p class="mt-1 text-xs text-slate-400">{definition.description}</p>
          </div>
          <p class="text-xs tabular-nums text-slate-500">
            {catalog.total} {catalog.total === 1 ? 'track' : 'tracks'} · Read-only
          </p>
        </div>
        {(catalog.error || state.playbackError) && (
          <p class="mt-3 text-xs text-red-300" role="alert">
            {catalog.error || state.playbackError}
          </p>
        )}
      </header>

      <div
        class={`${GRID_CLASS} min-h-[30px] border-b border-gray-700 text-xs text-slate-400`}
        style={{ paddingRight: 'var(--scrollbar-width)' }}
      >
        <span class="flex items-center px-2">#</span>
        <span class="flex items-center border-l border-gray-700 px-3">Title</span>
        <span class="flex items-center border-l border-gray-700 px-3">Artist</span>
        <span class="flex items-center border-l border-gray-700 px-3">Album</span>
        <span class="flex items-center justify-end border-l border-gray-700 px-3">Plays</span>
        <span class="flex items-center border-l border-gray-700 px-3">Last played</span>
      </div>

      <div class="relative min-h-0 flex-1">
        {catalog.status === 'loading' && catalog.total === 0 && (
          <div class="grid h-full place-items-center p-8 text-sm text-slate-400">Loading collection…</div>
        )}
        {catalog.status === 'ready' && catalog.total === 0 && (
          <div class="grid h-full place-items-center p-8 text-center text-sm text-slate-400">
            <div>
              <p class="text-slate-300">This collection is empty.</p>
              <p class="mt-2">{definition.emptyMessage}</p>
            </div>
          </div>
        )}
        <VirtualList
          numItems={catalog.total}
          itemHeight={ROW_HEIGHT}
          onRangeChange={$((startIndex, endIndex) => pager.value?.ensureRange(startIndex, endIndex))}
          renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
            const item = builtInCollectionItemAt(catalog, index)
            if (!item) return <div class="bg-gray-900" style={{ ...style, height: `${ROW_HEIGHT}px` }} />
            return (
              <div
                key={`${props.kind}:${item.track.id}`}
                class={`${GRID_CLASS} border-b border-gray-800 text-sm`}
                style={{ ...style, height: `${ROW_HEIGHT}px` }}
              >
                <span class="flex items-center px-2 tabular-nums text-slate-500">{index + 1}</span>
                <button
                  class="flex min-w-0 items-center border-l border-gray-800 px-3 text-left hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-slate-500"
                  onClick$={() => playItem(index)}
                  aria-label={`Play ${item.track.title} by ${item.track.artist || 'Unknown artist'}`}
                >
                  <span class="truncate">{item.track.title || '-'}</span>
                </button>
                <span class="flex min-w-0 items-center border-l border-gray-800 px-3">
                  <span class="truncate">{item.track.artist || '-'}</span>
                </span>
                <span class="flex min-w-0 items-center border-l border-gray-800 px-3">
                  <span class="truncate">{item.track.album || '-'}</span>
                </span>
                <span class="flex items-center justify-end border-l border-gray-800 px-3 tabular-nums text-slate-400">
                  {item.playCount}
                </span>
                <span class="flex items-center border-l border-gray-800 px-3 text-xs tabular-nums text-slate-500">
                  {formatLastPlayed(item.lastPlayedAt)}
                </span>
              </div>
            )
          })}
        />
      </div>
    </section>
  )
})

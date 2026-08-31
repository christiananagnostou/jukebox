import {
  $,
  component$,
  noSerialize,
  useComputed$,
  useContext,
  useSignal,
  useTask$,
  useVisibleTask$,
  type NoSerialize,
} from '@builder.io/qwik'

import type { ListItemStyle } from '~/App'
import { SoundBars } from '~/components/Shared/SoundBars'
import VirtualList from '~/components/Shared/VirtualList'
import { ClosedFolder } from '~/components/svg/ClosedFolder'
import { OpenFolder } from '~/components/svg/OpenFolder'
import { useStorageOpenNode, useStorageOpenParent, useStoragePlayNode } from '~/hooks/useStoragePage'
import { queryStorage, storageNodeAt, StoragePager } from '~/services/library-client'
import { StoreActionsContext, StoreContext } from '../layout'

const ROW_HEIGHT = 30

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const openNode = useStorageOpenNode(store)
  const openParent = useStorageOpenParent(store)
  const playNode = useStoragePlayNode(store, storeActions)
  const pager = useSignal<NoSerialize<StoragePager>>()
  const observedRefreshKey = useSignal(store.libraryCatalog.refreshKey)
  const direction = store.sorting.endsWith('-desc') ? 'desc' : 'asc'
  const segments = useComputed$(() => (store.storageView.parent ? store.storageView.parent.split('/') : []))

  useVisibleTask$(({ cleanup }) => {
    const controller = new StoragePager(store.storageView.nodes, queryStorage)
    pager.value = noSerialize(controller)
    void controller.reset({
      direction,
      parent: store.storageView.parent,
      q: store.searchTerm,
      rootId: store.storageView.rootId ?? undefined,
    })
    cleanup(() => {
      controller.dispose()
      pager.value = undefined
    })
  })

  useTask$(({ cleanup, track }) => {
    const parent = track(() => store.storageView.parent)
    const rootId = track(() => store.storageView.rootId)
    const searchTerm = track(() => store.searchTerm)
    const sorting = track(() => store.sorting)
    const nextDirection = sorting.endsWith('-desc') ? 'desc' : 'asc'
    const timeout = setTimeout(() => {
      store.storageView.cursorIdx = 0
      void pager.value?.reset({
        direction: nextDirection,
        parent,
        q: searchTerm,
        rootId: rootId ?? undefined,
      })
    }, 120)
    cleanup(() => clearTimeout(timeout))
  })

  useTask$(({ track }) => {
    const refreshKey = track(() => store.libraryCatalog.refreshKey)
    if (refreshKey === observedRefreshKey.value) return
    observedRefreshKey.value = refreshKey
    void pager.value?.reload()
  })

  const openBreadcrumb = $((index: number) => {
    store.storageView.cursorIdx = 0
    const parentSegments = store.storageView.parent ? store.storageView.parent.split('/') : []
    store.storageView.parent = index < 0 ? '' : parentSegments.slice(0, index + 1).join('/')
  })

  return (
    <section class="min-h-0 w-full flex flex-col flex-1 relative">
      <div class="flex h-[30px] shrink-0 items-center gap-1 border-b border-gray-700 px-2 text-sm">
        {store.storageView.rootId === null ? (
          <span class="text-gray-400">Folders</span>
        ) : (
          <>
            <button class="text-gray-400 hover:text-white" onClick$={openParent} aria-label="Go up one folder">
              Up
            </button>
            <span class="text-gray-600">/</span>
            <button class="max-w-48 truncate hover:text-white" onClick$={() => openBreadcrumb(-1)}>
              {store.storageView.rootName}
            </button>
            {segments.value.map((segment, index) => (
              <span class="contents" key={`${segment}-${index}`}>
                <span class="text-gray-600">/</span>
                <button class="max-w-48 truncate hover:text-white" onClick$={() => openBreadcrumb(index)}>
                  {segment}
                </button>
              </span>
            ))}
            {store.storageView.rootDisplayPath && !store.storageView.parent && (
              <span class="ml-auto max-w-[40%] truncate text-xs text-gray-500">
                {store.storageView.rootDisplayPath}
              </span>
            )}
          </>
        )}
      </div>

      {store.storageView.nodes.error && (
        <p class="absolute inset-x-4 top-12 z-10 border border-red-900 bg-gray-950 p-3 text-sm text-red-300">
          {store.storageView.nodes.error}
        </p>
      )}

      <div class="min-h-0 flex-1 relative">
        {!store.storageView.nodes.error && store.storageView.nodes.total === 0 && (
          <p
            class="absolute inset-0 grid place-items-center px-6 text-center text-sm text-slate-500"
            aria-live="polite"
          >
            {store.storageView.nodes.status === 'loading'
              ? 'Loading folders…'
              : store.searchTerm
                ? 'No files or folders match this search.'
                : store.storageView.rootId === null
                  ? 'Add a music folder in Settings to browse it here.'
                  : 'This folder has no indexed music.'}
          </p>
        )}
        <VirtualList
          numItems={store.storageView.nodes.total}
          itemHeight={ROW_HEIGHT}
          scrollToRow={store.storageView.cursorIdx}
          onRangeChange={$((startIndex, endIndex) => pager.value?.ensureRange(startIndex, endIndex))}
          renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
            const node = storageNodeAt(store.storageView.nodes, index)
            if (!node) return <div class="bg-gray-900" style={{ ...style, height: `${ROW_HEIGHT}px` }} />
            const highlighted = store.storageView.cursorIdx === index
            const isContainer = node.kind !== 'track'

            return (
              <button
                key={`${node.rootId}:${node.relativePath}:${node.kind}`}
                onDblClick$={() => (isContainer ? openNode(node) : playNode(node))}
                onClick$={() => (store.storageView.cursorIdx = index)}
                style={{ ...style, height: `${ROW_HEIGHT}px` }}
                class={`flex w-full items-center gap-3 truncate px-3 text-left text-sm hover:bg-[rgba(0,0,0,.15)]
                  ${highlighted && '!bg-gray-800'}`}
              >
                <span class={`w-4 shrink-0 text-slate-700 ${highlighted && '!text-gray-600'}`} aria-hidden="true">
                  {node.kind === 'root' ? <OpenFolder /> : node.kind === 'directory' ? <ClosedFolder /> : null}
                </span>
                <span class="relative min-w-0 flex-1 truncate">
                  <span class="absolute right-full pr-4">
                    {node.songId && store.playback.current?.id === node.songId && <SoundBars show />}
                  </span>
                  {node.name}
                </span>
                <span class="shrink-0 text-xs text-slate-500">
                  {node.trackCount} {node.trackCount === 1 ? 'track' : 'tracks'}
                </span>
              </button>
            )
          })}
        />
      </div>
    </section>
  )
})

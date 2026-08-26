import { component$, useComputed$, useContext, useTask$ } from '@builder.io/qwik'
import { StoreActionsContext, StoreContext } from '../layout'
import type { ListItemStyle } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import { OpenFolder } from '~/components/svg/OpenFolder'
import { ClosedFolder } from '~/components/svg/ClosedFolder'
import { SoundBars } from '~/components/Shared/SoundBars'
import { organizeFiles } from '~/utils/Files'
import { useStoragePage } from '~/hooks/useStoragePage'
import { useLegacyCatalog } from '~/services/library-client'

const RowHeight = 30

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const storageActions = useStoragePage(store, storeActions)

  useLegacyCatalog(store)

  const rootFile = useComputed$(() => organizeFiles(store.filteredSongs))

  useTask$(({ track }) => {
    const root = track(() => rootFile.value)
    store.storageView.rootFile = root
    storageActions.countAndMapFiles(root)
  })

  return (
    <section class="min-h-0 w-full flex flex-col flex-1">
      <div
        class="w-full text-sm text-left items-center border-b border-gray-700"
        style={{ height: RowHeight + 'px', paddingRight: 'var(--scrollbar-width)' }}
      ></div>

      <div class="min-h-0 flex-1">
        <VirtualList
          numItems={store.storageView.nodeCount}
          itemHeight={RowHeight}
          scrollToRow={store.storageView.cursorIdx}
          renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
            const file = store.storageView.pathIndexMap[index]

            const highlighted = store.storageView.cursorIdx === index
            const isPlaying = store.player.currSong && store.player.currSong.id === file.song?.id

            return (
              <button
                key={file.name}
                onDblClick$={() => storageActions.playFile(file)}
                onClick$={() => (store.storageView.cursorIdx = index)}
                style={{ ...style, height: RowHeight + 'px', paddingLeft: (file.level + 1) * 20 + 'px' }}
                class={`flex items-center truncate w-full text-sm hover:bg-[rgba(0,0,0,.15)]
                  ${highlighted && '!bg-gray-800'}`}
              >
                <span
                  class={`text-slate-700 mr-3
                  ${highlighted && '!text-gray-600'}`}
                  onClick$={() => {
                    file.isClosed = !file.isClosed
                    storageActions.countAndMapFiles(store.storageView.rootFile)
                  }}
                >
                  {(Boolean(file.children.length) || file.name === '/') &&
                    (file.isClosed ? <ClosedFolder /> : <OpenFolder />)}
                </span>

                <div class="relative">
                  <div class="absolute right-full pr-4">{isPlaying && <SoundBars show={isPlaying} />}</div>
                  {file.name}
                </div>
              </button>
            )
          })}
        />
      </div>
    </section>
  )
})

import { $, component$, useComputed$, useContext, useStore, useTask$, useVisibleTask$ } from '@builder.io/qwik'
import { StoreActionsContext, StoreContext } from '../layout'
// @ts-ignore
import { appWindow } from '@tauri-apps/api/window'
import type { ListItemStyle } from '~/App'
import VirtualList from '~/components/Shared/VirtualList'
import { OpenFolder } from '~/components/svg/OpenFolder'
import { ClosedFolder } from '~/components/svg/ClosedFolder'
import { SoundBars } from '~/components/Shared/SoundBars'
import { organizeFiles } from '~/utils/Files'
import { useStoragePage } from '~/hooks/useStoragePage'

interface AlbumsProps {}

const RowHeight = 30

export default component$<AlbumsProps>(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const storageActions = useStoragePage(store, storeActions)

  const state = useStore<{ virtualListHeight: number; windowHeight: number }>({ virtualListHeight: 0, windowHeight: 0 })

  const rootFile = useComputed$(() => organizeFiles(store.filteredSongs))

  useTask$(({ track }) => {
    const root = track(() => rootFile.value)
    store.storageView.rootFile = root
    storageActions.countAndMapFiles(root)
  })

  // eslint-disable-next-line qwik/no-use-visible-task
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
        class="w-full text-sm text-left items-center border-b border-gray-700"
        style={{ height: RowHeight + 'px', paddingRight: 'var(--scrollbar-width)' }}
      ></div>

      <div class="h-full" style={{ maxHeight: state.virtualListHeight + 'px' }}>
        <VirtualList
          numItems={store.storageView.nodeCount}
          itemHeight={RowHeight}
          windowHeight={state.virtualListHeight || 0}
          scrollToRow={store.storageView.cursorIdx}
          renderItem={component$(({ index, style }: { index: number; style: ListItemStyle }) => {
            const file = store.storageView.pathIndexMap[index]

            const highlighted = store.storageView.cursorIdx === index
            const isPlaying = store.player.currSong && store.player.currSong.id === file.song?.id

            return (
              <button
                key={file.name}
                onDblClick$={$(() => storageActions.playFile(file))}
                onClick$={$(() => (store.storageView.cursorIdx = index))}
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

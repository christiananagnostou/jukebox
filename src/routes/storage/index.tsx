import { component$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { StoreContext } from '../layout'
import { appWindow } from '@tauri-apps/api/window'

interface AlbumsProps {}

const RowHeight = 30

export default component$<AlbumsProps>(() => {
  const store = useContext(StoreContext)

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
        class="w-full text-sm grid grid-cols-[1fr_1fr_1fr] text-left items-center border-b border-gray-700"
        style={{ height: RowHeight + 'px', paddingRight: 'var(--scrollbar-width)' }}
      >
        File System
        {store.allSongs.map((song) => (
          <div>{song.path}</div>
        ))}
      </div>
    </section>
  )
})

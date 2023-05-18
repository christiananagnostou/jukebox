import { $, component$, useContext, useOnWindow, useSignal } from '@builder.io/qwik'
import { StoreContext } from '~/routes/layout'
// import { useServerTimeLoader } from '~/routes/layout'

export default component$(() => {
  // const serverTime = useServerTimeLoader()

  const store = useContext(StoreContext)
  const searchInput = useSignal<HTMLInputElement>()

  useOnWindow(
    'keydown',
    $((e: Event) => {
      if (!searchInput.value) return
      // @ts-ignore
      const { key } = e as { key: string }

      if (key === '/') {
        e.preventDefault()
        searchInput.value.focus()
        store.searchTerm = ''
      }
      if (key === 'Escape') {
        e.preventDefault()
        searchInput.value.blur()
        store.searchTerm = ''
      }
    })
  )

  return (
    <footer
      class="px-2 w-full flex gap-2 items-center border-t border-gray-700 sticky bottom-0 bg-[#17171f]"
      style={{ minHeight: 30 + 'px' }}
    >
      {/* <span>{serverTime.value.date}</span> */}

      <input
        ref={searchInput}
        type="text"
        name="Search"
        id="search-input"
        placeholder="Title, Artist, Album, Year.."
        value={store.searchTerm}
        /* @ts-ignore */
        onInput$={(e) => (store.searchTerm = e?.target?.value || '')}
        class="bg-inherit border border-gray-700 rounded flex-1 px-2 text-sm placeholder:text-slate-600"
      />
    </footer>
  )
})

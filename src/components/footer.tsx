import { $, component$, useContext, useOnWindow, useSignal } from '@builder.io/qwik'
import { StoreContext } from '~/routes/layout'

export default component$(() => {
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
      }
      if (key === 'Escape') {
        e.preventDefault()
        searchInput.value.blur()
        store.searchTerm = ''
      }
      if (key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        searchInput.value.blur()
      }
    })
  )

  const handleSearchInput = $((e: InputEvent) => {
    // @ts-ignore
    store.searchTerm = e?.target?.value || ''
    store.libraryView.cursorIdx = 0
    store.artistView.artistIdx = 0
    store.artistView.albumIdx = 0
    store.artistView.trackIdx = 0
    store.storageView.cursorIdx = 0
  })

  return (
    <footer
      class="w-full flex gap-1 items-center border-t border-gray-700 sticky bottom-0 bg-[var(--body-bg-solid)]"
      style={{ minHeight: 30 + 'px' }}
    >
      <input
        ref={searchInput}
        type="text"
        name="Search"
        id="search-input"
        placeholder="Search"
        value={store.searchTerm}
        autoComplete="false"
        autoCorrect="false"
        aria-autocomplete="none"
        onInput$={handleSearchInput}
        onBlur$={() => (store.isTyping = false)}
        onFocus$={() => (store.isTyping = true)}
        class="bg-inherit h-full flex-1 px-2 text-sm placeholder:text-slate-600 focus:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)] focus:outline-none"
      />
    </footer>
  )
})

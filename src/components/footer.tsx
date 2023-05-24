import { $, component$, useContext, useOnWindow, useSignal } from '@builder.io/qwik'
import MusicPicker from '~/components/Shared/MusicPicker'
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
    store.highlightedIndex = 0
  })

  return (
    <footer
      class="px-1 w-full flex gap-1 items-center border-t border-gray-700 sticky bottom-0 bg-[var(--body-bg)]"
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
        onInput$={handleSearchInput}
        onBlur$={() => (store.isTyping = false)}
        onFocus$={() => (store.isTyping = true)}
        class="bg-inherit border border-gray-700 rounded flex-1 px-2 text-sm placeholder:text-slate-600"
      />

      <MusicPicker />
    </footer>
  )
})

import { $, component$, useComputed$, useContext, useOnWindow, useSignal } from '@builder.io/qwik'
import { useLocation, useNavigate } from '@builder.io/qwik-city'
import { StoreContext } from '~/routes/layout'

export default component$(() => {
  const store = useContext(StoreContext)
  const location = useLocation()
  const navigate = useNavigate()
  const searchInput = useSignal<HTMLInputElement>()

  useOnWindow(
    'keydown',
    $((e: Event) => {
      if (!searchInput.value) return
      const { key } = e as KeyboardEvent

      if (key === '/') {
        e.preventDefault()
        void navigate('/songs/')
        searchInput.value.focus()
      }
      if (key === 'Escape') {
        e.preventDefault()
        searchInput.value.blur()
        store.searchTerm = ''
      }
      if (key === 'Enter' && store.isTyping) {
        e.preventDefault()
        e.stopPropagation()
        searchInput.value.blur()
      }
    })
  )

  const handleSearchInput = $((_event: InputEvent, input: HTMLInputElement) => {
    store.searchTerm = input.value
    store.libraryView.cursorIdx = 0
    store.artistView.artistIdx = 0
    store.artistView.albumIdx = 0
    store.artistView.trackIdx = 0
    store.storageView.cursorIdx = 0
  })

  const focusSearch = $(() => {
    store.isTyping = true
    if (location.url.pathname !== '/songs/') void navigate('/songs/')
  })

  const clearSearch = $(() => {
    store.searchTerm = ''
    store.libraryView.cursorIdx = 0
    searchInput.value?.focus()
  })

  const footerStatus = useComputed$(() => {
    const progress = store.sync.total ? ` ${store.sync.processed}/${store.sync.total}` : ''
    const syncStatus =
      store.sync.status === 'idle'
        ? ''
        : store.sync.status === 'error'
          ? store.sync.message || 'Library operation failed'
          : `${store.sync.message || (store.sync.status === 'scanning' ? 'Scanning' : 'Importing')}${progress}`
    return (
      syncStatus ||
      store.bootstrap.libraryError ||
      store.bootstrap.settingsWarning ||
      `${store.libraryCatalog.total} songs`
    )
  })

  return (
    <footer class="library-search-footer">
      <div class="library-search-field">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          ref={searchInput}
          type="search"
          name="Search"
          id="search-input"
          placeholder="Search your library"
          value={store.searchTerm}
          autoComplete="off"
          autoCorrect="off"
          aria-autocomplete="none"
          aria-label="Search your music library"
          onInput$={handleSearchInput}
          onBlur$={() => (store.isTyping = false)}
          onFocus$={focusSearch}
        />
        {store.searchTerm ? (
          <button type="button" onClick$={clearSearch} aria-label="Clear library search" title="Clear search">
            ×
          </button>
        ) : (
          <kbd aria-label="Press slash to search">/</kbd>
        )}
      </div>
      <span class="library-search-status" aria-live="polite">
        {footerStatus.value}
      </span>
    </footer>
  )
})

import type { Store, StoreActions } from '~/App'
import { $ } from '@builder.io/qwik'

export const LibraryStore = {
  libraryView: {
    cursorIdx: 0,
  },
}

export function useLibraryPage(store: Store, storeActions: StoreActions) {
  const playHighlighted = $(() => {
    store.playlist = store.filteredSongs
    storeActions.playSong(store.filteredSongs[store.libraryView.cursorIdx], store.libraryView.cursorIdx)
  })

  const highlightUp = $(() => {
    store.libraryView.cursorIdx =
      store.libraryView.cursorIdx <= 0 ? store.filteredSongs.length - 1 : store.libraryView.cursorIdx - 1
  })

  const highlightDown = $(() => {
    store.libraryView.cursorIdx =
      store.libraryView.cursorIdx >= store.filteredSongs.length - 1 ? 0 : store.libraryView.cursorIdx + 1
  })

  return {
    playHighlighted,
    highlightUp,
    highlightDown,
  }
}

import type { Store, StoreActions } from '~/App'
import { $ } from '@builder.io/qwik'

export const LibraryStore = {
  libraryView: {
    cursorIdx: 0,
  },
}

export function useLibraryPage(store: Store, storeActions: StoreActions) {
  const playHighlighted = $(() => {
    const song = store.filteredSongs[store.libraryView.cursorIdx]
    if (!song) return
    store.playlist = store.filteredSongs
    storeActions.playSong(song, store.libraryView.cursorIdx)
  })

  const highlightUp = $(() => {
    if (!store.filteredSongs.length) return
    store.libraryView.cursorIdx =
      store.libraryView.cursorIdx <= 0 ? store.filteredSongs.length - 1 : store.libraryView.cursorIdx - 1
  })

  const highlightDown = $(() => {
    if (!store.filteredSongs.length) return
    store.libraryView.cursorIdx =
      store.libraryView.cursorIdx >= store.filteredSongs.length - 1 ? 0 : store.libraryView.cursorIdx + 1
  })

  return {
    playHighlighted,
    highlightUp,
    highlightDown,
  }
}

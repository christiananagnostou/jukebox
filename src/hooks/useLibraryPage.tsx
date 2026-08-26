import type { Store, StoreActions } from '~/App'
import { $ } from '@builder.io/qwik'
import { lastLoadedLibraryIndex, libraryPlaybackAt } from '~/services/library-client'

export const LibraryStore = {
  libraryView: {
    cursorIdx: 0,
  },
}

export function useLibraryPage(store: Store, storeActions: StoreActions) {
  const playHighlighted = $(() => {
    const playback = libraryPlaybackAt(store.libraryCatalog, store.libraryView.cursorIdx)
    if (!playback) return
    store.playlist = playback.playlist
    storeActions.playSong(playback.song, playback.playlistIndex)
  })

  const highlightUp = $(async () => {
    if (!store.libraryCatalog.total) return
    store.libraryView.cursorIdx =
      store.libraryView.cursorIdx <= 0 ? lastLoadedLibraryIndex(store.libraryCatalog) : store.libraryView.cursorIdx - 1
    await storeActions.requestLibraryRange(store.libraryView.cursorIdx, store.libraryView.cursorIdx)
  })

  const highlightDown = $(async () => {
    if (!store.libraryCatalog.total) return
    store.libraryView.cursorIdx =
      store.libraryView.cursorIdx >= store.libraryCatalog.total - 1 ? 0 : store.libraryView.cursorIdx + 1
    await storeActions.requestLibraryRange(store.libraryView.cursorIdx, store.libraryView.cursorIdx)
  })

  return {
    playHighlighted,
    highlightUp,
    highlightDown,
  }
}

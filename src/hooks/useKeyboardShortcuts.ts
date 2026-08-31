import { $, useOnWindow } from '@builder.io/qwik'
import { useLocation, useNavigate } from '@builder.io/qwik-city'

import type { Store, StoreActions } from '~/App'
import { matchesNavigationShortcut, NAVIGATION_COMMANDS } from '~/services/app-commands'
import { lastLoadedLibraryIndex, librarySongAt, storageNodeAt } from '~/services/library-client'

import { useArtistPage } from './useArtistPage'
import { useLibraryPage } from './useLibraryPage'
import {
  useStorageHighlightDown,
  useStorageHighlightUp,
  useStorageOpenNode,
  useStorageOpenParent,
  useStoragePlayNode,
} from './useStoragePage'

export function useKeyboardShortcuts(store: Store, storeActions: StoreActions) {
  const nav = useNavigate()
  const location = useLocation()
  const highlightDown = useStorageHighlightDown(store)
  const highlightUp = useStorageHighlightUp(store)
  const openNode = useStorageOpenNode(store)
  const openParent = useStorageOpenParent(store)
  const playNode = useStoragePlayNode(store, storeActions)
  const artistActions = useArtistPage(store, storeActions)
  const libraryActions = useLibraryPage(store, storeActions)

  useOnWindow(
    'keydown',
    $((e: Event) => {
      if (store.isTyping) return
      const keyboardEvent = e as KeyboardEvent
      const { key, code } = keyboardEvent
      const pathname = location.url.pathname

      if (pathname === '/songs/' || pathname === '/songs') {
        if (key === 'j') libraryActions.highlightDown()
        if (key === 'k') libraryActions.highlightUp()
        if (key === 'Enter') libraryActions.playHighlighted()
        if (key === 'g') store.libraryView.cursorIdx = 0
        if (key === 'G') {
          store.libraryView.cursorIdx = lastLoadedLibraryIndex(store.libraryCatalog)
          void storeActions.requestLibraryRange(store.libraryView.cursorIdx, store.libraryView.cursorIdx)
        }
        if (key === 'q') {
          const song = librarySongAt(store.libraryCatalog, store.libraryView.cursorIdx)
          if (song) void storeActions.enqueueSong(song)
        }
      }

      if (pathname === '/artists/') {
        if (key === 'j') artistActions.moveCursorDown()
        if (key === 'k') artistActions.moveCursorUp()
        if (key === 'l') artistActions.moveCursorRight()
        if (key === 'h') artistActions.moveCursorLeft()
        if (key === 'Enter') artistActions.playHighlighted()
      }

      if (pathname === '/storage/') {
        if (key === 'j') highlightDown()
        if (key === 'k') highlightUp()
        if (key === 'h') openParent()
        if (key === 'l') {
          const node = storageNodeAt(store.storageView.nodes, store.storageView.cursorIdx)
          openNode(node)
        }
        if (key === 'Enter') {
          const node = storageNodeAt(store.storageView.nodes, store.storageView.cursorIdx)
          playNode(node)
        }
      }

      if (key === 'n' || code === 'MediaTrackNext') void storeActions.nextSong()
      if (key === 'N' || code === 'MediaTrackPrevious') void storeActions.prevSong()
      if (key === 'p') {
        if (store.playback.isPaused) {
          void storeActions.resumeSong()
        } else {
          void storeActions.pauseSong()
        }
      }

      for (const command of NAVIGATION_COMMANDS) {
        if (command.href && command.shortcut && matchesNavigationShortcut(keyboardEvent, command.shortcut)) {
          e.preventDefault()
          void nav(command.href)
          return
        }
      }
      if (key === '?') store.showKeyShortcuts = !store.showKeyShortcuts
      if (key === 'Escape' && store.showKeyShortcuts) store.showKeyShortcuts = false
    })
  )
}

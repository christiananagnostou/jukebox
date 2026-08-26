import { $, useOnWindow } from '@builder.io/qwik'
import { useLocation, useNavigate } from '@builder.io/qwik-city'
import type { Store, StoreActions } from '~/App'
import { useStoragePage } from './useStoragePage'
import { useArtistPage } from './useArtistPage'
import { useLibraryPage } from './useLibraryPage'
import { lastLoadedLibraryIndex, librarySongAt } from '~/services/library-client'

export const KeyboardCommands = [
  {
    type: 'header',
    title: 'Movement',
    commands: [
      { key: 'j', command: 'Down' },
      { key: 'k', command: 'Move Up' },
      { key: 'h', command: 'Left' },
      { key: 'l', command: 'Right' },
      { key: 'g', command: 'To List Top' },
      { key: 'G', command: 'To List Bottom' },
    ],
  },

  {
    type: 'header',
    title: 'Audio Control',
    commands: [
      { key: 'Enter', command: 'Play Song' },
      { key: 'n', command: 'Next Song' },
      { key: '⇧ N', command: 'Prev Song' },
      { key: 'p', command: 'Pause/Play' },
      { key: 'q', command: 'Add Song to Queue' },
    ],
  },

  {
    type: 'header',
    title: 'Pages',
    commands: [
      { key: '⇧ L', command: 'Library' },
      { key: '⇧ A', command: 'Artists' },
      { key: '⇧ O', command: 'Storage' },
      { key: '⇧ M', command: 'Albums' },
      { key: '⇧ S', command: 'Settings' },
    ],
  },

  {
    type: 'header',
    title: 'Utility',
    commands: [
      { key: '/', command: 'Search' },
      { key: '⇧ I', command: 'Import Music' },
      { key: '?', command: 'Toggle Shortcuts' },
    ],
  },
]

export function useKeyboardShortcuts(store: Store, storeActions: StoreActions) {
  const nav = useNavigate()
  const location = useLocation()
  const storageActions = useStoragePage(store, storeActions)
  const artistActions = useArtistPage(store, storeActions)
  const libraryActions = useLibraryPage(store, storeActions)

  useOnWindow(
    'keydown',
    $((e: Event) => {
      if (store.isTyping) return
      const { key, code } = e as KeyboardEvent
      const pathname = location.url.pathname

      if (pathname === '/') {
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
          if (song) store.queue.push(song)
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
        if (key === 'j') storageActions.highlightDown()
        if (key === 'k') storageActions.highlightUp()
        if (key === 'Enter') {
          const file = store.storageView.pathIndexMap[store.storageView.cursorIdx]
          storageActions.playFile(file)
        }
      }

      if (key === 'n' || code === 'MediaTrackNext') storeActions.nextSong()
      if (key === 'N' || code === 'MediaTrackPrevious') storeActions.prevSong()
      if (key === 'p') {
        if (store.player.isPaused) {
          storeActions.resumeSong()
        } else {
          storeActions.pauseSong()
        }
      }

      if (key === 'L') nav('/')
      if (key === 'A') nav('/artists')
      if (key === 'O') nav('/storage')
      if (key === 'M') nav('/albums')
      if (key === 'S') nav('/settings')
      if (key === '?') store.showKeyShortcuts = !store.showKeyShortcuts
      if (key === 'Escape' && store.showKeyShortcuts) store.showKeyShortcuts = false
    })
  )
}

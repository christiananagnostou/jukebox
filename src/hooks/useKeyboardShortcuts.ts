import { $, useOnWindow } from '@builder.io/qwik'
import { useLocation, useNavigate } from '@builder.io/qwik-city'
import type { Store, StoreActions } from '~/App'
import { useStoragePage } from './useStoragePage'
import { useArtistPage } from './useArtistPage'
import { useLibraryPage } from './useLibraryPage'

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
      // { key: 's', command: 'Seek Forward' },
      // { key: '⇧ S', command: 'Seek Back' },
    ],
  },

  {
    type: 'header',
    title: 'Pages',
    commands: [
      { key: '⇧ L', command: 'Library' },
      { key: '⇧ A', command: 'Artists' },
      { key: '⇧ O', command: 'Storage' },
      // { key: '⇧ P', command: 'Playlists' },
      { key: '⇧ M', command: 'Albums' },
    ],
  },

  {
    type: 'header',
    title: 'Utility',
    commands: [
      { key: '/', command: 'Search' },
      { key: '⇧ I', command: 'Import Files' },
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
      // @ts-ignore
      const { key } = e as { key: string }

      /**
       *
       * Library View Specific
       *
       */
      if (location.url.pathname == '/') {
        // Move Hightlight Down
        if (key === 'j') libraryActions.highlightDown()

        // Move Hightlight Up
        if (key === 'k') libraryActions.highlightUp()

        // Play Highlighted Song
        if (key === 'Enter') libraryActions.playHighlighted()

        // Move Hightlight to Top
        if (key === 'g') store.libraryView.cursorIdx = 0

        // Move Hightlight to Bottom
        if (key === 'G') store.libraryView.cursorIdx = store.filteredSongs.length - 1

        // Play Highlighted Song
        if (key === 'q') store.queue.push(store.filteredSongs[store.libraryView.cursorIdx])
      }

      /**
       *
       * Artists View Specific
       *
       */
      if (location.url.pathname == '/artists/') {
        // Move Hightlight Down
        if (key === 'j') artistActions.moveCursorDown()

        // Move Hightlight Up
        if (key === 'k') artistActions.moveCursorUp()

        // Move Hightlight Right
        if (key === 'l') artistActions.moveCursorRight()

        // Move Hightlight Left
        if (key === 'h') artistActions.moveCursorLeft()

        // Play Highlighted Song
        if (key === 'Enter') artistActions.playHighlighted()
      }

      /**
       *
       * Storage View Specific
       *
       */
      if (location.url.pathname == '/storage/') {
        // Move Hightlight Down
        if (key === 'j') storageActions.highlightDown()
        // Move Hightlight Up
        if (key === 'k') storageActions.highlightUp()
        // Play Highlighted Song
        if (key === 'Enter') {
          const file = store.storageView.pathIndexMap[store.storageView.cursorIdx]
          storageActions.playFile(file)
        }
      }

      /**
       *
       * Audio Player
       *
       */

      // Next Song
      if (key === 'n') storeActions.nextSong()

      // Previous Song
      if (key === 'N') storeActions.prevSong()

      // Pause/Play
      if (key === 'p') store.player.isPaused ? storeActions.resumeSong() : storeActions.pauseSong()

      /**
       *
       * Route Navigation
       *
       */

      // Navigate to Home (Library) Page
      if (key === 'L') nav('/')

      // Navigate to Artists Page
      if (key === 'A') nav('/artists')

      // Navigate to Storage Page
      if (key === 'O') nav('/storage')

      /**
       *
       * Utility
       *
       */

      // Toggle Keyboard Shortcuts Modal
      if (key === '?') store.showKeyShortcuts = !store.showKeyShortcuts

      // Close Keyboard Shortcuts Modal
      if (key === 'Escape' && store.showKeyShortcuts) store.showKeyShortcuts = false

      // Sorting By Recent
      if (key === 'r') store.sorting = 'recent-asc'
    })
  )
}

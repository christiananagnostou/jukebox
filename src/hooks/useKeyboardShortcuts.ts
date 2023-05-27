import { $, useOnWindow } from '@builder.io/qwik'
import { useNavigate } from '@builder.io/qwik-city'
import type { Store, StoreActions } from '~/App'

export function useKeyboardShortcuts(store: Store, storeActions: StoreActions) {
  const nav = useNavigate()

  useOnWindow(
    'keydown',
    $((e: Event) => {
      if (store.isTyping) return
      // @ts-ignore
      const { key } = e as { key: string }

      console.log(key)
      // Move Hightlight Down
      if (key === 'j')
        store.highlightedIndex =
          store.highlightedIndex >= store.displayedSongs.length - 1 ? 0 : store.highlightedIndex + 1
      // Move Hightlight Up
      if (key === 'k')
        store.highlightedIndex =
          store.highlightedIndex <= 0 ? store.displayedSongs.length - 1 : store.highlightedIndex - 1
      // Move Hightlight to Top
      if (key === 'g') store.highlightedIndex = 0
      // Move Hightlight to Bottom
      if (key === 'G') store.highlightedIndex = store.displayedSongs.length - 1
      // Play Highlighted Song
      if (key === 'Enter') storeActions.playSong(store.displayedSongs[store.highlightedIndex], store.highlightedIndex)
      // Play Highlighted Song
      if (key === 'q') store.queue.push(store.displayedSongs[store.highlightedIndex])
      // Next Song
      if (key === 'n') storeActions.nextSong()
      // Previous Song
      if (key === 'N') storeActions.prevSong()
      // Pause/Play
      if (key === 'p') store.player.isPaused ? storeActions.resumeSong() : storeActions.pauseSong()
      // Navigate to Albums Page
      if (key === 'A') nav('/albums')
      // Navigate to Home (Library) Page
      if (key === 'L') nav('/')
      // Toggle Keyboard Shortcuts Modal
      if (key === '?') store.showKeyShortcuts = !store.showKeyShortcuts
    })
  )
}

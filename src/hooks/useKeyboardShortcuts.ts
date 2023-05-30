import { $, useOnWindow } from '@builder.io/qwik'
import { useLocation, useNavigate } from '@builder.io/qwik-city'
import type { Album, Song, Store, StoreActions } from '~/App'

export function useKeyboardShortcuts(store: Store, storeActions: StoreActions) {
  const nav = useNavigate()
  const location = useLocation()

  useOnWindow(
    'keydown',
    $((e: Event) => {
      if (store.isTyping) return
      // @ts-ignore
      const { key } = e as { key: string }

      console.log(key)
      console.log(location.url)

      // Library View Specific
      if (location.url.pathname == '/') {
        // Move Hightlight Down
        if (key === 'j')
          store.libraryView.cursorIdx =
            store.libraryView.cursorIdx >= store.filteredSongs.length - 1 ? 0 : store.libraryView.cursorIdx + 1

        // Move Hightlight Up
        if (key === 'k')
          store.libraryView.cursorIdx =
            store.libraryView.cursorIdx <= 0 ? store.filteredSongs.length - 1 : store.libraryView.cursorIdx - 1

        // Play Highlighted Song
        if (key === 'Enter') {
          store.playlist = store.filteredSongs
          storeActions.playSong(store.filteredSongs[store.libraryView.cursorIdx], store.libraryView.cursorIdx)
        }
      }

      // Artists View Specific
      if (location.url.pathname == '/artists/') {
        // Move Hightlight Down
        if (key === 'j') {
          // Artist Col
          if (store.artistView.cursorCol === 0) {
            store.artistView.artistIdx < store.artistView.artists.length - 1 && store.artistView.artistIdx++
            store.artistView.albumIdx = 0
            store.artistView.trackIdx = 0
          }
          // Albums Col
          if (store.artistView.cursorCol === 1) {
            store.artistView.albumIdx < store.artistView.albums.length - 1 && store.artistView.albumIdx++
            store.artistView.trackIdx = 0
          }
          // Tracks Col
          if (store.artistView.cursorCol === 2) {
            store.artistView.trackIdx < store.artistView.tracks.length - 1 && store.artistView.trackIdx++
          }
        }

        // Move Hightlight Up
        if (key === 'k') {
          // Artist Col
          if (store.artistView.cursorCol === 0) {
            store.artistView.artistIdx > 0 && store.artistView.artistIdx--
            store.artistView.albumIdx = 0
            store.artistView.trackIdx = 0
          }
          // Albums Col
          if (store.artistView.cursorCol === 1) {
            store.artistView.albumIdx > 0 && store.artistView.albumIdx--
            store.artistView.trackIdx = 0
          }
          // Tracks Col
          if (store.artistView.cursorCol === 2) {
            store.artistView.trackIdx > 0 && store.artistView.trackIdx--
          }
        }

        // Move Hightlight Right
        if (key === 'l') if (store.artistView.cursorCol < 2) store.artistView.cursorCol++

        // Move Hightlight Left
        if (key === 'h') if (store.artistView.cursorCol > 0) store.artistView.cursorCol--

        // Play Highlighted Song
        if (key === 'Enter') {
          // Play all albums from selected artist
          if (store.artistView.cursorCol === 0) {
            // Reset album index
            store.artistView.albumIdx = 0
            // Get all songs from all playlists
            store.playlist = store.artistView.albums.reduce(
              (result: Song[], current: Album) => result.concat(...current.tracks),
              []
            )
            storeActions.playSong(store.playlist[0], 0)
          }
          // Play all tracks from selected album
          if (store.artistView.cursorCol === 1) {
            store.playlist = store.artistView.tracks
            storeActions.playSong(store.artistView.tracks[0], 0)
          }
          // Play selected track and set curr album to playlist
          if (store.artistView.cursorCol === 2) {
            store.playlist = store.artistView.tracks
            storeActions.playSong(store.artistView.tracks[store.artistView.trackIdx], store.artistView.trackIdx)
          }
        }
      }

      // Move Hightlight to Top
      if (key === 'g') store.libraryView.cursorIdx = 0

      // Move Hightlight to Bottom
      if (key === 'G') store.libraryView.cursorIdx = store.filteredSongs.length - 1

      // Play Highlighted Song
      if (key === 'q') store.queue.push(store.filteredSongs[store.libraryView.cursorIdx])

      // Next Song
      if (key === 'n') storeActions.nextSong()

      // Previous Song
      if (key === 'N') storeActions.prevSong()

      // Pause/Play
      if (key === 'p') store.player.isPaused ? storeActions.resumeSong() : storeActions.pauseSong()

      // Navigate to Albums Page
      if (key === 'A') nav('/artists')

      // Navigate to Home (Library) Page
      if (key === 'L') nav('/')

      // Toggle Keyboard Shortcuts Modal
      if (key === '?') store.showKeyShortcuts = !store.showKeyShortcuts
    })
  )
}

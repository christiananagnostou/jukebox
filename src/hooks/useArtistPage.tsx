import type { Store, StoreActions, Song, Album } from '~/App'
import { $ } from '@builder.io/qwik'

export const ArtistPageState = {
  artistView: {
    artistIdx: 0,
    albumIdx: 0,
    trackIdx: 0,
    cursorCol: 0,
    artists: [],
    albums: [],
    tracks: [],
  },
}

export function useArtistPage(store: Store, storeActions: StoreActions) {
  const _playAllAlbumsShown = $(() => {
    // Reset album index
    store.artistView.albumIdx = 0
    // Get all songs from all playlists
    store.playlist = store.artistView.albums.reduce(
      (result: Song[], current: Album) => result.concat(...current.tracks),
      []
    )
    storeActions.playSong(store.playlist[0], 0)
  })

  const _playShownAlbum = $(() => {
    store.playlist = store.artistView.tracks
    storeActions.playSong(store.artistView.tracks[0], 0)
  })

  const _playTrack = $(() => {
    store.playlist = store.artistView.tracks
    storeActions.playSong(store.artistView.tracks[store.artistView.trackIdx], store.artistView.trackIdx)
  })

  const playHighlighted = $(async () => {
    // Play all albums from selected artist
    if (store.artistView.cursorCol === 0) {
      await _playAllAlbumsShown()
    }
    // Play all tracks from selected album
    if (store.artistView.cursorCol === 1) {
      await _playShownAlbum()
    }
    // Play selected track and set curr album to playlist
    if (store.artistView.cursorCol === 2) {
      await _playTrack()
    }
  })

  const moveCursorUp = $(() => {
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
  })

  const moveCursorDown = $(() => {
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
  })

  const moveCursorLeft = $(() => store.artistView.cursorCol > 0 && store.artistView.cursorCol--)

  const moveCursorRight = $(() => store.artistView.cursorCol < 2 && store.artistView.cursorCol++)

  return {
    playHighlighted,
    moveCursorUp,
    moveCursorDown,
    moveCursorLeft,
    moveCursorRight,
  }
}

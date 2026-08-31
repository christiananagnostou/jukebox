import type { Store, StoreActions } from '~/App'
import { $ } from '@builder.io/qwik'
import { aggregateItemAt, librarySongAt, loadTrackSelection } from '~/services/library-client'

export const ArtistPageState: Pick<Store, 'artistView'> = {
  artistView: {
    artistIdx: 0,
    albumIdx: 0,
    trackIdx: 0,
    cursorCol: 0,
    artists: { error: '', pages: {}, revision: 0, status: 'loading', total: 0 },
    albums: { error: '', pages: {}, revision: 0, status: 'loading', total: 0 },
    tracks: {
      error: '',
      loadedSongCount: 0,
      pages: {},
      refreshKey: 0,
      revision: 0,
      status: 'loading',
      total: 0,
    },
    selectedArtistKey: '',
    selectedAlbumKey: '',
  },
}

export function useArtistPage(store: Store, storeActions: StoreActions) {
  const _playAllAlbumsShown = $(async () => {
    const artist = aggregateItemAt(store.artistView.artists, store.artistView.artistIdx)
    if (!artist) return
    store.artistView.albumIdx = 0
    const songs = await loadTrackSelection({
      artist: artist.value,
      direction: 'asc',
      q: store.searchTerm,
      sort: 'default',
    })
    if (songs[0]) storeActions.playTracks(songs, 0, { kind: 'artist', label: artist.name })
  })

  const _playShownAlbum = $(async () => {
    const album = aggregateItemAt(store.artistView.albums, store.artistView.albumIdx)
    if (!album) return
    const songs = await loadTrackSelection({
      album: album.value,
      artist: album.artistValue,
      direction: 'asc',
      q: store.searchTerm,
      sort: 'track',
    })
    if (songs[0]) storeActions.playTracks(songs, 0, { kind: 'album', label: album.name })
  })

  const _playTrack = $(async () => {
    const song = librarySongAt(store.artistView.tracks, store.artistView.trackIdx)
    if (!song) return
    const album = aggregateItemAt(store.artistView.albums, store.artistView.albumIdx)
    if (!album) return
    const songs = await loadTrackSelection({
      album: album.value,
      artist: album.artistValue,
      direction: 'asc',
      q: store.searchTerm,
      sort: 'track',
    })
    const playlistIndex = songs.findIndex((track) => track.id === song.id)
    if (playlistIndex >= 0) {
      storeActions.playTracks(songs, playlistIndex, { kind: 'album', label: album.name })
    }
  })

  const playHighlighted = $(async () => {
    try {
      if (store.artistView.cursorCol === 0) await _playAllAlbumsShown()
      if (store.artistView.cursorCol === 1) await _playShownAlbum()
      if (store.artistView.cursorCol === 2) await _playTrack()
      store.bootstrap.libraryError = ''
    } catch {
      store.bootstrap.libraryError = 'Jukebox could not prepare that selection for playback.'
    }
  })

  const moveCursorUp = $(() => {
    if (store.artistView.cursorCol === 0) {
      if (store.artistView.artistIdx > 0) {
        store.artistView.artistIdx -= 1
      }
      store.artistView.albumIdx = 0
      store.artistView.trackIdx = 0
    }
    if (store.artistView.cursorCol === 1) {
      if (store.artistView.albumIdx > 0) {
        store.artistView.albumIdx -= 1
      }
      store.artistView.trackIdx = 0
    }
    if (store.artistView.cursorCol === 2) {
      if (store.artistView.trackIdx > 0) {
        store.artistView.trackIdx -= 1
      }
    }
  })

  const moveCursorDown = $(() => {
    if (store.artistView.cursorCol === 0) {
      if (store.artistView.artistIdx < store.artistView.artists.total - 1) {
        store.artistView.artistIdx += 1
      }
      store.artistView.albumIdx = 0
      store.artistView.trackIdx = 0
    }
    if (store.artistView.cursorCol === 1) {
      if (store.artistView.albumIdx < store.artistView.albums.total - 1) {
        store.artistView.albumIdx += 1
      }
      store.artistView.trackIdx = 0
    }
    if (store.artistView.cursorCol === 2) {
      if (store.artistView.trackIdx < store.artistView.tracks.total - 1) {
        store.artistView.trackIdx += 1
      }
    }
  })

  const moveCursorLeft = $(() => {
    if (store.artistView.cursorCol > 0) {
      store.artistView.cursorCol -= 1
    }
  })

  const moveCursorRight = $(() => {
    if (store.artistView.cursorCol < 2) {
      store.artistView.cursorCol += 1
    }
  })

  return {
    playHighlighted,
    moveCursorUp,
    moveCursorDown,
    moveCursorLeft,
    moveCursorRight,
  }
}

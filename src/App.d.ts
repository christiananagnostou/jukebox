export interface Store {
  allSongs: Song[]
  filteredSongs: Song[]
  playlist: Song[]
  sorting: 'title-desc' | 'title-asc' | 'artist-desc' | 'artist-asc' | 'album-desc' | 'album-asc' | 'default'
  searchTerm: string
  audioDir: string

  libraryView: {
    cursorIdx: number
  }
  artistView: {
    artistIdx: number
    albumIdx: number
    trackIdx: number
    cursorCol: number

    artists: Artist[]
    albums: Album[]
    tracks: Song[]
  }

  isTyping: boolean
  showKeyShortcuts: boolean
  queue: Song[]

  player: {
    currSong?: Song
    currSongIndex: number
    audioElem?: HTMLAudioElement
    nextAudioElem?: HTMLAudioElement
    isPaused: boolean
    currentTime: number
    duration: number
  }
}

export interface Album {
  title: string
  tracks: Song[]
}

export interface Artist {
  name: string
  albums: Album[]
}

export interface Song {
  id: string
  path: string
  file: string
  title: string
  album: string
  artist: string
  genre: string
  bpm: number
  compilation: number
  date: string
  encoder: string
  trackTotal: number
  trackNumber: number
  codec: string
  duration: string
  sampleRate: string

  side: number
  startTime: number
  isFavorite: boolean
}

export interface Metadata {
  codec: string
  duration: string
  sample_rate: string
  path_name: string
  file_name: string
  file_size: number
  meta_tags: { [key: string]: string }
}

export type ListItemStyle = {
  position: 'absolute'
  top: string
  width: '100%'
}

export interface StoreActions {
  loadSong: QRL<(song: Song) => void>
  playSong: QRL<(song: Song, index: number) => void>
  pauseSong: QRL<() => void>
  resumeSong: QRL<() => void>
  nextSong: QRL<() => void>
  prevSong: QRL<() => void>
}

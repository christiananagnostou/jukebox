export interface Store {
  allSongs: Song[]
  filteredSongs: Song[]
  playlist: Song[]
  searchTerm: string
  audioDir: string

  sorting:
    | 'title-desc'
    | 'title-asc'
    | 'artist-desc'
    | 'artist-asc'
    | 'album-desc'
    | 'album-asc'
    | 'track-asc'
    | 'track-desc'
    | 'hertz-asc'
    | 'hertz-desc'
    | 'date-asc'
    | 'date-desc'
    | 'fave-asc'
    | 'fave-desc'
    | 'default'

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

  storageView: {
    cursorIdx: number
    rootFile: FileNode
    pathIndexMap: PathIndexMap
    nodeCount: number
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
  favorRating: 0 | 1 | 2
}

export interface Metadata {
  codec: string
  duration: string
  sample_rate: string
  path_name: string
  file_name: string
  file_size: number
  meta_tags: { [key: string]: string }
  visual_info: {
    media_type: string
    media_data: number[]
  }
}

export interface AlbumArt {
  mediaType: string
  mediaData: number[]
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

  addSongInOrder: QRL<(song: Song) => void>
}

export interface FileNode {
  name: string
  children: FileNode[]
  song?: Song
  level: number
  isClosed: boolean
  hidden: boolean
}

export interface PathIndexMap {
  [index: number]: FileNode
}

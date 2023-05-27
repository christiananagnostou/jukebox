export interface Store {
  allSongs: Song[]
  displayedSongs: Song[]
  sorting: 'title-desc' | 'title-asc' | 'artist-desc' | 'artist-asc' | 'album-desc' | 'album-asc' | 'default'
  searchTerm: string
  audioDir: string
  highlightedIndex: number
  isTyping: boolean
  showKeyShortcuts: boolean

  queue: Song[]

  player: {
    currSong?: Song
    prevSong?: Song
    nextSong?: Song
    currSongIndex: number
    audioElem?: HTMLAudioElement
    nextAudioElem?: HTMLAudioElement
    isPaused: boolean
    currentTime: number
    duration: number
  }
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
  side: number
  startTime: number
  isFavorite: boolean
}

export interface Metadata {
  codec: string
  duration: string
  path_name: string
  file_name: string
  sample_rate: string
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

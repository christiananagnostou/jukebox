export interface Store {
  allSongs: Song[]
  sorting: 'title-desc' | 'title-asc' | 'artist-desc' | 'artist-asc' | 'album-desc' | 'album-asc' | 'default'
  searchTerm: string
  audioDir: string
  pathPrefix: 'asset://localhost/'
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
  track: number
  side: number
  isFavorite: boolean
}

export type ListItemStyle = {
  position: 'absolute'
  top: string
  width: '100%'
}

export interface StoreActions {
  loadSong: QRL<(song: Song) => void>
  playSong: QRL<(song: Song, index?: number) => void>
  nextSong: QRL<() => void>
  prevSong: QRL<() => void>
}

export interface Store {
  addedSongs: Song[]
  audioDir: string
  currSong?: Song
  currAudioElem?: HTMLAudioElement
  nextAudioElem?: HTMLAudioElement
}

export interface Song {
  id: string // A hash of the filepath
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

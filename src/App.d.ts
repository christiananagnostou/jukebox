export interface Store {
  allSongs: Song[]
  audioDir: string
  pathPrefix: 'asset://localhost/'
  player: {
    currSong?: Song
    audioElem?: HTMLAudioElement
    nextAudioElem?: HTMLAudioElement
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

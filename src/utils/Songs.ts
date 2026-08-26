import type { Song } from '~/App'

const compareText = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: 'base' })

export function compareSongsByAlbumTrack(left: Song, right: Song): number {
  return (
    compareText(left.album, right.album) ||
    left.side - right.side ||
    left.trackNumber - right.trackNumber ||
    compareText(left.title, right.title) ||
    compareText(left.path, right.path)
  )
}

export function mergeSongs(existingSongs: Song[], importedSongs: Song[]): Song[] {
  const songsById = new Map(existingSongs.map((song) => [song.id, song]))

  for (const song of importedSongs) {
    songsById.set(song.id, song)
  }

  return [...songsById.values()].sort(compareSongsByAlbumTrack)
}

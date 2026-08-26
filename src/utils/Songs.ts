import type { Song, Store } from '~/App'

const compareText = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: 'base' })
const searchIndex = new WeakMap<Song, { source: string; value: string }>()

function searchableText(song: Song): string {
  const source = `${song.title}\0${song.artist}\0${song.album}`
  const cached = searchIndex.get(song)
  if (cached?.source === source) return cached.value

  const value = source.toLocaleLowerCase()
  searchIndex.set(song, { source, value })
  return value
}

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

export function compareSongs(sorting: Store['sorting']): (left: Song, right: Song) => number {
  if (sorting === 'default') return compareSongsByAlbumTrack

  const direction = sorting.endsWith('-desc') ? -1 : 1
  const field = sorting.replace(/-(asc|desc)$/, '')

  return (left, right) => {
    let result = 0

    switch (field) {
      case 'title':
        result = compareText(left.title, right.title)
        break
      case 'artist':
        result =
          compareText(left.artist, right.artist) ||
          compareText(left.album, right.album) ||
          left.trackNumber - right.trackNumber
        break
      case 'album':
        result =
          compareText(left.album, right.album) ||
          compareText(left.artist, right.artist) ||
          left.trackNumber - right.trackNumber
        break
      case 'track':
        result = left.trackNumber - right.trackNumber || compareText(left.title, right.title)
        break
      case 'hertz':
        result = Number(left.sampleRate) - Number(right.sampleRate)
        break
      case 'date':
        result = Number(left.date || 0) - Number(right.date || 0)
        break
      case 'fave':
        result = left.favorRating - right.favorRating
        break
      case 'date-added':
        result = Date.parse(left.dateAdded) - Date.parse(right.dateAdded)
        break
    }

    return direction * (result || compareSongsByAlbumTrack(left, right))
  }
}

export function filterAndSortSongs(songs: Song[], searchTerm: string, sorting: Store['sorting']): Song[] {
  const query = searchTerm.trim().toLocaleLowerCase()
  const filteredSongs = query ? songs.filter((song) => searchableText(song).includes(query)) : [...songs]

  return filteredSongs.sort(compareSongs(sorting))
}

import type { PlaybackSource, Song } from '~/App'

export interface PlaybackSourceCopy {
  description: string
  heading: string
  href: string
  searchTerm?: string
}

function uniformValue(songs: Song[], field: 'album' | 'artist'): string {
  const values = new Set(songs.map((song) => song[field].trim()).filter(Boolean))
  return values.size === 1 ? [...values][0] : ''
}

export function playbackSourceCopy(source: PlaybackSource | undefined, songs: Song[]): PlaybackSourceCopy {
  if (source?.kind === 'album') {
    return {
      heading: `From ${source.label}`,
      description: 'Continuing this album',
      href: '/albums/',
      searchTerm: source.label,
    }
  }
  if (source?.kind === 'artist') {
    return {
      heading: `More from ${source.label}`,
      description: 'Continuing this artist selection',
      href: '/artists/',
      searchTerm: source.label,
    }
  }
  if (source?.kind === 'playlist') {
    return { heading: `From ${source.label}`, description: 'Continuing this playlist', href: '/playlists/' }
  }
  if (source?.kind === 'collection') {
    return { heading: `From ${source.label}`, description: 'Continuing this collection', href: '/playlists/' }
  }
  if (source?.kind === 'folder') {
    return { heading: `From ${source.label}`, description: 'Continuing this folder', href: '/storage/' }
  }
  if (source?.kind === 'library') {
    return { heading: 'From your library', description: 'Continuing your current library order', href: '/' }
  }

  const album = uniformValue(songs, 'album')
  if (album)
    return { heading: `From ${album}`, description: 'Continuing this album', href: '/albums/', searchTerm: album }
  const artist = uniformValue(songs, 'artist')
  if (artist) {
    return {
      heading: `More from ${artist}`,
      description: 'Continuing this artist selection',
      href: '/artists/',
      searchTerm: artist,
    }
  }
  return { heading: 'From your library', description: 'Continuing your current library order', href: '/' }
}

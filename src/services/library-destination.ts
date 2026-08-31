import type { TrackQuery } from '~/services/library-client'

const MAX_EXACT_METADATA_LENGTH = 1_024

export type LibraryDestination = { kind: 'artist'; artist: string } | { kind: 'album'; album: string; artist: string }

export interface TrackMetadataDestinations {
  album?: LibraryDestination
  artist?: LibraryDestination
}

function isValidExactMetadata(value: string): boolean {
  const length = [...value].length
  return Boolean(value.trim()) && length <= MAX_EXACT_METADATA_LENGTH
}

function readSingleParameter(parameters: URLSearchParams, name: string): string | undefined {
  const values = parameters.getAll(name)
  if (values.length !== 1 || !isValidExactMetadata(values[0])) return undefined
  return values[0]
}

export function artistDestination(artist: string): LibraryDestination | undefined {
  return isValidExactMetadata(artist) ? { kind: 'artist', artist } : undefined
}

export function albumDestination(artist: string, album: string): LibraryDestination | undefined {
  return isValidExactMetadata(artist) && isValidExactMetadata(album) ? { kind: 'album', album, artist } : undefined
}

export function trackMetadataDestinations(track: { album: string; artist: string }): TrackMetadataDestinations {
  return {
    album: albumDestination(track.artist, track.album),
    artist: artistDestination(track.artist),
  }
}

export function libraryDestinationHref(destination: LibraryDestination): string {
  const parameters = new URLSearchParams({ artist: destination.artist })
  if (destination.kind === 'album') parameters.set('album', destination.album)
  return `/${destination.kind === 'album' ? 'albums' : 'artists'}/view/#${parameters.toString()}`
}

export function libraryDestinationParameters(url: URL): URLSearchParams {
  return url.hash ? new URLSearchParams(url.hash.slice(1)) : url.searchParams
}

export function parseLibraryDestination(
  parameters: URLSearchParams,
  expectedKind: LibraryDestination['kind']
): LibraryDestination | undefined {
  const artist = readSingleParameter(parameters, 'artist')
  if (!artist) return undefined

  if (expectedKind === 'artist') {
    return parameters.has('album') ? undefined : { kind: 'artist', artist }
  }

  const album = readSingleParameter(parameters, 'album')
  return album ? { kind: 'album', album, artist } : undefined
}

export function focusedCollectionQuery(destination: LibraryDestination): Omit<TrackQuery, 'cursor' | 'limit'> {
  return {
    ...(destination.kind === 'album' ? { album: destination.album } : {}),
    artist: destination.artist,
    direction: 'asc',
    q: '',
    sort: destination.kind === 'album' ? 'track' : 'default',
  }
}

export function libraryDestinationLabel(destination: LibraryDestination): string {
  return destination.kind === 'album' ? destination.album : destination.artist
}

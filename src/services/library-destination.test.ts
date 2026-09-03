import { describe, expect, it } from 'vitest'

import {
  albumDestination,
  albumSummaryDestination,
  albumSummaryTrackQuery,
  artistDestination,
  compilationAlbumDestination,
  focusedCollectionQuery,
  libraryDestinationHref,
  libraryDestinationLabel,
  libraryDestinationParameters,
  parseLibraryDestination,
  trackMetadataDestinations,
} from './library-destination'

describe('library destinations', () => {
  it('creates an exact artist destination', () => {
    expect(artistDestination('Björk')).toEqual({ artist: 'Björk', kind: 'artist' })
  })

  it('creates an exact album destination with its artist identity', () => {
    expect(albumDestination('Björk', 'Homogenic')).toEqual({ album: 'Homogenic', artist: 'Björk', kind: 'album' })
  })

  it('creates an album-wide destination for compilations', () => {
    expect(compilationAlbumDestination('Remember The Titans')).toEqual({
      album: 'Remember The Titans',
      kind: 'album',
    })
  })

  it('keeps compilation album summaries album-wide across browse and playback', () => {
    const supernatural = {
      artistValue: '',
      isCompilation: true,
      value: 'Supernatural',
    }

    expect(albumSummaryDestination(supernatural)).toEqual({ album: 'Supernatural', kind: 'album' })
    expect(albumSummaryTrackQuery(supernatural)).toEqual({
      album: 'Supernatural',
      direction: 'asc',
      q: '',
      sort: 'track',
    })
  })

  it('keeps standard album summaries scoped to their artist', () => {
    expect(albumSummaryTrackQuery({ artistValue: 'Santana', isCompilation: false, value: 'Supernatural' })).toEqual({
      album: 'Supernatural',
      artist: 'Santana',
      direction: 'asc',
      q: '',
      sort: 'track',
    })
  })

  it('preserves catalog whitespace while using trimmed validation', () => {
    expect(albumDestination('  Artist  ', '  Album  ')).toEqual({
      album: '  Album  ',
      artist: '  Artist  ',
      kind: 'album',
    })
  })

  it('rejects blank artist and album values', () => {
    expect(artistDestination(' \n ')).toBeUndefined()
    expect(albumDestination('Artist', '\t')).toBeUndefined()
    expect(albumDestination('', 'Album')).toBeUndefined()
  })

  it('enforces the native exact-filter character bound', () => {
    expect(artistDestination('a'.repeat(1_024))).toBeDefined()
    expect(artistDestination('a'.repeat(1_025))).toBeUndefined()
    expect(albumDestination('Artist', '🎵'.repeat(1_025))).toBeUndefined()
  })

  it('encodes Unicode and URL punctuation through URLSearchParams', () => {
    const destination = albumDestination('AC/DC & Friends', '¿Dónde? / 東京')
    expect(destination && libraryDestinationHref(destination)).toBe(
      '/albums/view/#artist=AC%2FDC+%26+Friends&album=%C2%BFD%C3%B3nde%3F+%2F+%E6%9D%B1%E4%BA%AC'
    )
  })

  it('round trips an artist URL', () => {
    const destination = artistDestination('Sigur Rós')!
    const url = new URL(libraryDestinationHref(destination), 'https://jukebox.invalid')
    expect(parseLibraryDestination(libraryDestinationParameters(url), 'artist')).toEqual(destination)
  })

  it('round trips an album URL without collapsing same-named albums', () => {
    const first = albumDestination('Artist One', 'Greatest Hits')!
    const second = albumDestination('Artist Two', 'Greatest Hits')!
    const firstUrl = new URL(libraryDestinationHref(first), 'https://jukebox.invalid')
    const secondUrl = new URL(libraryDestinationHref(second), 'https://jukebox.invalid')

    expect(parseLibraryDestination(libraryDestinationParameters(firstUrl), 'album')).toEqual(first)
    expect(parseLibraryDestination(libraryDestinationParameters(secondUrl), 'album')).toEqual(second)
    expect(libraryDestinationHref(first)).not.toBe(libraryDestinationHref(second))
  })

  it('round trips a compilation album without an artist filter', () => {
    const destination = compilationAlbumDestination('Disneyland Park Official Album (c) 2001')!
    const url = new URL(libraryDestinationHref(destination), 'https://jukebox.invalid')
    expect(parseLibraryDestination(libraryDestinationParameters(url), 'album')).toEqual(destination)
    expect(focusedCollectionQuery(destination)).toEqual({
      album: 'Disneyland Park Official Album (c) 2001',
      direction: 'asc',
      q: '',
      sort: 'track',
    })
  })

  it('rejects repeated identity parameters', () => {
    expect(parseLibraryDestination(new URLSearchParams('artist=One&artist=Two'), 'artist')).toBeUndefined()
    expect(parseLibraryDestination(new URLSearchParams('artist=One&album=First&album=Second'), 'album')).toBeUndefined()
  })

  it('falls back to standard query parameters for compatible web hosts', () => {
    const url = new URL('https://jukebox.invalid/artists/view/?artist=Bj%C3%B6rk')
    expect(parseLibraryDestination(libraryDestinationParameters(url), 'artist')).toEqual({
      artist: 'Björk',
      kind: 'artist',
    })
  })

  it('rejects an album parameter on an artist route', () => {
    expect(parseLibraryDestination(new URLSearchParams('artist=One&album=First'), 'artist')).toBeUndefined()
  })

  it('rejects missing and empty parameters', () => {
    expect(parseLibraryDestination(new URLSearchParams(), 'artist')).toBeUndefined()
    expect(parseLibraryDestination(new URLSearchParams('artist=&album=First'), 'album')).toBeUndefined()
    expect(parseLibraryDestination(new URLSearchParams('artist=One&album='), 'album')).toBeUndefined()
  })

  it('builds an exact artist track query', () => {
    expect(focusedCollectionQuery({ artist: 'Björk', kind: 'artist' })).toEqual({
      artist: 'Björk',
      direction: 'asc',
      q: '',
      sort: 'default',
    })
  })

  it('builds a disc-aware exact album track query', () => {
    expect(focusedCollectionQuery({ album: 'Homogenic', artist: 'Björk', kind: 'album' })).toEqual({
      album: 'Homogenic',
      artist: 'Björk',
      direction: 'asc',
      q: '',
      sort: 'track',
    })
  })

  it('uses the visible entity as the destination label', () => {
    expect(libraryDestinationLabel({ artist: 'Björk', kind: 'artist' })).toBe('Björk')
    expect(libraryDestinationLabel({ album: 'Homogenic', artist: 'Björk', kind: 'album' })).toBe('Homogenic')
  })

  it('derives exact artist and album links from track metadata', () => {
    expect(trackMetadataDestinations({ album: 'Homogenic', artist: 'Björk' })).toEqual({
      album: { album: 'Homogenic', artist: 'Björk', kind: 'album' },
      artist: { artist: 'Björk', kind: 'artist' },
    })
  })

  it('links a compilation track back to its complete album', () => {
    expect(
      trackMetadataDestinations({
        album: 'Supernatural',
        artist: 'Santana Feat. Rob Thomas',
        compilation: 1,
      })
    ).toEqual({
      album: { album: 'Supernatural', kind: 'album' },
      artist: { artist: 'Santana Feat. Rob Thomas', kind: 'artist' },
    })
  })

  it('does not create a misleading album link without artist identity', () => {
    expect(trackMetadataDestinations({ album: 'Greatest Hits', artist: '' })).toEqual({
      album: undefined,
      artist: undefined,
    })
  })
})

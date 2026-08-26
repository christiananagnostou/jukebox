import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import type { LibraryCatalogState, Song } from '~/App'
import {
  catalogQuery,
  LIBRARY_PAGE_SIZE,
  LibraryPager,
  loadLegacyCatalog,
  MAX_RETAINED_LIBRARY_PAGES,
  queryAlbums,
  queryArtists,
  queryTracks,
  type TrackPageFetcher,
} from './library-client'

const song = (id: number): Song => ({
  id: String(id),
  path: `/music/${id}.flac`,
  file: `${id}.flac`,
  title: `Track ${id}`,
  album: 'Album',
  artist: 'Artist',
  genre: '',
  bpm: 0,
  compilation: 0,
  date: '2026',
  encoder: '',
  trackTotal: 0,
  trackNumber: id,
  codec: 'flac',
  duration: '0:01:00.000',
  sampleRate: '44100',
  side: 1,
  startTime: 0,
  favorRating: 0,
  dateAdded: '2026-08-26',
  visualsPath: '',
})

const state = (): LibraryCatalogState => ({
  error: '',
  loadedSongCount: 0,
  pages: {},
  refreshKey: 0,
  revision: 0,
  status: 'loading',
  total: 0,
})

function fixtureFetcher(count: number, requests: string[] = []): TrackPageFetcher {
  return async (query) => {
    const start = query.cursor ? Number(query.cursor) : 0
    requests.push(`${query.q}:${query.sort}:${query.direction}:${start}`)
    const end = Math.min(count, start + query.limit)
    const items = Array.from({ length: end - start }, (_, offset) => song(start + offset))
    const next = start + items.length
    return {
      items,
      nextCursor: next < count ? String(next) : undefined,
      revision: 7,
      total: count,
    }
  }
}

describe('catalogQuery', () => {
  it('maps the existing UI sort names to the native contract', () => {
    expect(catalogQuery('jazz', 'default')).toEqual({ direction: 'asc', q: 'jazz', sort: 'default' })
    expect(catalogQuery('', 'hertz-desc')).toEqual({ direction: 'desc', q: '', sort: 'sample_rate' })
    expect(catalogQuery('', 'date-added-asc')).toEqual({ direction: 'asc', q: '', sort: 'date_added' })
  })
})

describe('native library commands', () => {
  beforeEach(() => invokeMock.mockReset())

  it('sends exact track filters through the shared query boundary', async () => {
    invokeMock.mockResolvedValue({ items: [], revision: 3, total: 0 })
    const query = {
      album: 'Homogenic',
      artist: 'Björk',
      direction: 'asc' as const,
      limit: 50,
      q: '',
      sort: 'track' as const,
    }

    await queryTracks(query)

    expect(invokeMock).toHaveBeenCalledWith('query_tracks', { query })
  })

  it('uses bounded aggregate query payloads for artist and album pages', async () => {
    invokeMock.mockResolvedValue({ items: [], revision: 3, total: 0 })
    const query = { direction: 'desc' as const, limit: 50, offset: 100, q: 'ambient' }

    await queryArtists(query)
    await queryAlbums(query)

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'query_artists', { query })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'query_albums', { query })
  })
})

describe('LibraryPager', () => {
  it('loads one bounded page initially and adjacent pages on demand', async () => {
    const requests: string[] = []
    const catalog = state()
    const pager = new LibraryPager(catalog, fixtureFetcher(250, requests))

    await pager.reset('', 'default')
    expect(requests).toHaveLength(1)
    expect(catalog.loadedSongCount).toBe(LIBRARY_PAGE_SIZE)
    expect(catalog.total).toBe(250)

    await pager.ensureRange(100, 130)
    expect(requests).toHaveLength(2)
    expect(catalog.loadedSongCount).toBe(200)

    await pager.reload()
    expect(requests).toHaveLength(3)
    expect(catalog.loadedSongCount).toBe(LIBRARY_PAGE_SIZE)
  })

  it('retains one page at startup even for a 100,000-track catalog', async () => {
    const requests: string[] = []
    const catalog = state()
    const pager = new LibraryPager(catalog, fixtureFetcher(100_000, requests))

    await pager.reset('', 'default')

    expect(catalog.total).toBe(100_000)
    expect(catalog.loadedSongCount).toBe(LIBRARY_PAGE_SIZE)
    expect(requests).toHaveLength(1)
  })

  it('ignores stale results after a query change', async () => {
    const catalog = state()
    let release: (() => void) | undefined
    const fetchPage: TrackPageFetcher = async (query) => {
      if (query.q === 'old') await new Promise<void>((resolve) => (release = resolve))
      return { items: [song(query.q === 'old' ? 1 : 2)], revision: 1, total: 1 }
    }
    const pager = new LibraryPager(catalog, fetchPage)

    const oldRequest = pager.reset('old', 'default')
    await Promise.resolve()
    const newRequest = pager.reset('new', 'default')
    if (!release) throw new Error('old request did not start')
    release()
    await Promise.all([oldRequest, newRequest])

    expect(catalog.pages['0']?.[0].id).toBe('2')
  })

  it('keeps retained song pages below the documented cap', async () => {
    const catalog = state()
    const pager = new LibraryPager(catalog, fixtureFetcher(900))
    await pager.reset('', 'default')
    await pager.ensureRange(700, 750)

    expect(Object.keys(catalog.pages).length).toBeLessThanOrEqual(MAX_RETAINED_LIBRARY_PAGES)
    expect(catalog.loadedSongCount).toBeLessThanOrEqual(MAX_RETAINED_LIBRARY_PAGES * LIBRARY_PAGE_SIZE)
  })
})

describe('loadLegacyCatalog', () => {
  it('uses repeated bounded pages only when explicitly requested', async () => {
    const requests: string[] = []
    const songs = await loadLegacyCatalog(fixtureFetcher(205, requests))

    expect(songs).toHaveLength(205)
    expect(requests).toHaveLength(3)
  })
})

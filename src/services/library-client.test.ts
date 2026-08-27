import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import type { LibraryCatalogState, Song, StorageNode } from '~/App'
import {
  aggregateItemAt,
  AggregatePager,
  type AggregateCatalogState,
  AGGREGATE_PAGE_SIZE,
  catalogQuery,
  LIBRARY_PAGE_SIZE,
  LibraryPager,
  loadTrackSelection,
  MAX_RETAINED_AGGREGATE_PAGES,
  MAX_RETAINED_LIBRARY_PAGES,
  queryAlbums,
  queryArtists,
  queryStorage,
  queryTracks,
  storageNodeAt,
  StoragePager,
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
    const query = { artist: 'Björk', direction: 'desc' as const, limit: 50, offset: 100, q: 'ambient' }

    await queryArtists(query)
    await queryAlbums(query)

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'query_artists', { query })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'query_albums', { query })
  })

  it('sends bounded storage traversal payloads through the native boundary', async () => {
    invokeMock.mockResolvedValue({ items: [], revision: 3, total: 0 })
    const query = {
      direction: 'asc' as const,
      limit: 100,
      offset: 200,
      parent: 'Albums/Live',
      q: '',
      rootId: 4,
    }

    await queryStorage(query)

    expect(invokeMock).toHaveBeenCalledWith('query_storage', { query })
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

  it('preserves exact drill-down filters when a catalog refresh reloads the pager', async () => {
    const filters: string[] = []
    const catalog = state()
    const pager = new LibraryPager(catalog, async (query) => {
      filters.push(`${query.artist}:${query.album}`)
      return { items: [], revision: 1, total: 0 }
    })

    await pager.resetQuery({
      album: 'Album',
      artist: 'Artist',
      direction: 'asc',
      q: '',
      sort: 'track',
    })
    await pager.reload()

    expect(filters).toEqual(['Artist:Album', 'Artist:Album'])
  })
})

describe('AggregatePager', () => {
  const aggregateState = (): AggregateCatalogState<number> => ({
    error: '',
    pages: {},
    revision: 0,
    status: 'loading',
    total: 0,
  })

  it('loads direct bounded pages and caps retained memory', async () => {
    const requests: number[] = []
    const catalog = aggregateState()
    const pager = new AggregatePager(catalog, async (query) => {
      requests.push(query.offset)
      const items = Array.from({ length: query.limit }, (_, index) => query.offset + index)
      return { items, revision: 4, total: 1_000 }
    })

    await pager.reset({ direction: 'asc', q: '' })
    await pager.ensureRange(700, 799)

    expect(requests).toEqual([0, 700])
    expect(aggregateItemAt(catalog, 750)).toBe(750)
    expect(Object.keys(catalog.pages)).toHaveLength(2)

    for (let page = 1; page <= MAX_RETAINED_AGGREGATE_PAGES + 1; page += 1) {
      await pager.ensureRange(page * AGGREGATE_PAGE_SIZE, page * AGGREGATE_PAGE_SIZE)
    }
    expect(Object.keys(catalog.pages).length).toBeLessThanOrEqual(MAX_RETAINED_AGGREGATE_PAGES)
  })

  it('restarts at the first page when revisions change', async () => {
    const requests: number[] = []
    const catalog = aggregateState()
    let revision = 1
    const pager = new AggregatePager(catalog, async (query) => {
      requests.push(query.offset)
      return { items: [query.offset], revision, total: 200 }
    })

    await pager.reset({ direction: 'asc', q: '' })
    revision = 2
    await pager.ensureRange(100, 100)

    expect(requests).toEqual([0, 100, 0])
    expect(catalog.revision).toBe(2)
    expect(catalog.pages['1']).toBeUndefined()
  })
})

describe('StoragePager', () => {
  const storageState = (): AggregateCatalogState<StorageNode> => ({
    error: '',
    pages: {},
    revision: 0,
    status: 'loading',
    total: 0,
  })

  it('preserves root and parent filters while paging bounded directory rows', async () => {
    const requests: Array<{ offset: number; parent: string; rootId?: number }> = []
    const catalog = storageState()
    const pager = new StoragePager(catalog, async (query) => {
      requests.push({ offset: query.offset, parent: query.parent, rootId: query.rootId })
      const node: StorageNode = {
        displayPath: '/Music/Albums/Live',
        kind: 'directory',
        name: 'Live',
        relativePath: 'Albums/Live',
        rootId: 4,
        trackCount: 12,
      }
      return { items: [node], revision: 5, total: 201 }
    })

    await pager.reset({ direction: 'asc', parent: 'Albums', q: '', rootId: 4 })
    await pager.ensureRange(200, 200)

    expect(requests).toEqual([
      { offset: 0, parent: 'Albums', rootId: 4 },
      { offset: 200, parent: 'Albums', rootId: 4 },
    ])
    expect(storageNodeAt(catalog, 200)?.relativePath).toBe('Albums/Live')
  })
})

describe('loadTrackSelection', () => {
  it('loads repeated bounded pages only after an explicit selection action', async () => {
    const requests: string[] = []
    const songs = await loadTrackSelection(
      { album: 'Album', artist: 'Artist', direction: 'asc', q: '', sort: 'track' },
      fixtureFetcher(205, requests)
    )

    expect(songs).toHaveLength(205)
    expect(requests).toHaveLength(3)
  })

  it('preserves root and path filters across every selection page', async () => {
    const requests: Array<{ pathPrefix?: string; rootId?: number }> = []
    const songs = await loadTrackSelection(
      { direction: 'asc', pathPrefix: 'Albums/Live', q: '', rootId: 4, sort: 'default' },
      async (query) => {
        requests.push({ pathPrefix: query.pathPrefix, rootId: query.rootId })
        return {
          items: query.cursor ? [] : [song(1)],
          nextCursor: query.cursor ? undefined : 'next',
          revision: 1,
          total: 1,
        }
      }
    )

    expect(songs).toHaveLength(1)
    expect(requests).toEqual([
      { pathPrefix: 'Albums/Live', rootId: 4 },
      { pathPrefix: 'Albums/Live', rootId: 4 },
    ])
  })
})

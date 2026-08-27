import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import type { Song } from '~/App'
import {
  BUILT_IN_COLLECTIONS,
  builtInCollectionDefinition,
  formatLastPlayed,
} from '~/components/playlists/built-in-collections'
import {
  builtInCollectionItemAt,
  builtInCollectionPlaybackAt,
  type BuiltInCollectionCatalogState,
  type BuiltInCollectionItem,
  BuiltInCollectionPager,
  BUILT_IN_COLLECTION_PAGE_SIZE,
  MAX_RETAINED_BUILT_IN_COLLECTION_PAGES,
  queryBuiltInCollection,
} from './library-client'

const song = (id: number): Song => ({
  album: 'Album',
  artist: 'Artist',
  bpm: 0,
  codec: 'flac',
  compilation: 0,
  date: '2026',
  dateAdded: '2026-08-27',
  duration: '0:03:00.000',
  encoder: '',
  favorRating: 0,
  file: `${id}.flac`,
  genre: '',
  id: String(id),
  path: `/music/${id}.flac`,
  sampleRate: '44100',
  side: 1,
  startTime: 0,
  title: `Track ${id}`,
  trackNumber: id + 1,
  trackTotal: 10,
  visualsPath: '',
})

const item = (id: number): BuiltInCollectionItem => ({
  lastPlayedAt: '2026-08-27T00:00:00.000Z',
  listenedMs: 60_000,
  playCount: 1,
  track: song(id),
})

const state = (): BuiltInCollectionCatalogState => ({
  error: '',
  pages: {},
  revision: '',
  status: 'loading',
  total: 0,
})

describe('built-in collection client', () => {
  beforeEach(() => invoke.mockReset())

  it('sends one bounded typed native query', async () => {
    invoke.mockResolvedValue({ items: [], revision: '8:13:5', total: 0 })

    await expect(queryBuiltInCollection({ kind: 'most_played', limit: 100, offset: 200 })).resolves.toEqual({
      items: [],
      revision: '8:13:5',
      total: 0,
    })
    expect(invoke).toHaveBeenCalledWith('query_built_in_collection', {
      query: { kind: 'most_played', limit: 100, offset: 200 },
    })
  })

  it('keeps the compact built-in labels and stable UTC presentation', () => {
    expect(BUILT_IN_COLLECTIONS.map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: 'recently_played', label: 'Recently Played' },
      { kind: 'most_played', label: 'Most Played' },
      { kind: 'never_played', label: 'Never Played' },
    ])
    expect(builtInCollectionDefinition('most_played').label).toBe('Most Played')
    expect(formatLastPlayed('2026-08-27T01:42:59.000Z')).toBe('2026-08-27 01:42 UTC')
    expect(formatLastPlayed(null)).toBe('—')
  })

  it('bounds pages, retains only nearby data, and exposes page-local playback', async () => {
    const catalog = state()
    const fetchPage = vi.fn(async ({ offset }: { offset: number }) => ({
      items: [item(offset)],
      revision: '1:1:1',
      total: 700,
    }))
    const pager = new BuiltInCollectionPager(catalog, fetchPage)

    await pager.reset('recently_played')
    await pager.ensureRange(0, 699)

    expect(BUILT_IN_COLLECTION_PAGE_SIZE * MAX_RETAINED_BUILT_IN_COLLECTION_PAGES).toBe(500)
    expect(Object.keys(catalog.pages)).toHaveLength(MAX_RETAINED_BUILT_IN_COLLECTION_PAGES)
    expect(catalog.pages['0']).toBeUndefined()
    expect(catalog.pages['6']).toBeUndefined()
    expect(builtInCollectionItemAt(catalog, 300)?.track.id).toBe('300')

    catalog.pages = { '0': [item(0), item(1)] }
    expect(builtInCollectionPlaybackAt(catalog, 1)).toEqual({
      playlist: [song(0), song(1)],
      playlistIndex: 1,
      song: song(1),
    })
  })

  it('restarts from the first page when history changes between pages', async () => {
    const catalog = state()
    let calls = 0
    const fetchPage = vi.fn(async ({ offset }: { offset: number }) => {
      calls += 1
      return {
        items: [item(offset)],
        revision: calls === 1 ? '1:1:0' : '1:2:1',
        total: 200,
      }
    })
    const pager = new BuiltInCollectionPager(catalog, fetchPage)

    await pager.reset('most_played')
    await pager.ensureRange(100, 100)

    expect(fetchPage.mock.calls.map(([query]) => query.offset)).toEqual([0, 100, 0])
    expect(catalog.revision).toBe('1:2:1')
    expect(Object.keys(catalog.pages)).toEqual(['0'])
    expect(catalog.status).toBe('ready')
  })

  it('surfaces path-free native failures without retaining stale rows', async () => {
    const catalog = state()
    catalog.pages = { '0': [item(0)] }
    const pager = new BuiltInCollectionPager(catalog, async () => {
      throw { code: 'database_unavailable', message: 'The music library is temporarily unavailable.' }
    })

    await pager.reset('never_played')

    expect(catalog.pages).toEqual({})
    expect(catalog.status).toBe('error')
    expect(catalog.error).toBe('The music library is temporarily unavailable.')
  })
})

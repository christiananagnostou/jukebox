import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import {
  createSmartPlaylist,
  deleteSmartPlaylist,
  getSmartPlaylist,
  MAX_RETAINED_SMART_PLAYLIST_PAGES,
  querySmartPlaylist,
  smartPlaylistItemAt,
  SmartPlaylistPager,
  smartPlaylistPlaybackAt,
  updateSmartPlaylist,
  type SmartPlaylistCatalogState,
  type SmartPlaylistDefinition,
  type SmartPlaylistItem,
} from './smart-playlist-client'

const playlistId = 'playlist_0123456789abcdef0123456789abcdef'
const definition: SmartPlaylistDefinition = {
  version: 1,
  matchMode: 'all',
  rules: [
    { field: 'availability', operator: 'is', value: 'available' },
    { field: 'favorite', operator: 'greater_than_or_equal', value: 1 },
  ],
  resultLimit: 500,
  sort: 'date_added',
  direction: 'desc',
}

function catalogState(): SmartPlaylistCatalogState {
  return { error: '', pages: {}, revision: '', status: 'loading', total: 0 }
}

function item(id: string, availability: SmartPlaylistItem['availability'] = 'available'): SmartPlaylistItem {
  return {
    availability,
    lastPlayedAt: null,
    listenedMs: 0,
    playCount: 0,
    track: {
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
      id,
      path: `/music/${id}.flac`,
      sampleRate: '44100',
      side: 1,
      startTime: 0,
      title: id,
      trackNumber: 1,
      trackTotal: 1,
      visualsPath: '',
    },
  }
}

describe('native smart playlist client', () => {
  beforeEach(() => invokeMock.mockReset())

  it('uses bounded camelCase payloads for the smart playlist lifecycle', async () => {
    invokeMock.mockResolvedValue({ affected: 1 })

    await createSmartPlaylist('Favorites', definition)
    await getSmartPlaylist(playlistId)
    await updateSmartPlaylist(playlistId, 'Best favorites', definition)
    await deleteSmartPlaylist(playlistId)

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'create_smart_playlist', {
      definition,
      name: 'Favorites',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'get_smart_playlist', { playlistId })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'update_smart_playlist', {
      definition,
      name: 'Best favorites',
      playlistId,
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'delete_smart_playlist', { playlistId })
  })

  it('queries only bounded pages by stable playlist identity', async () => {
    invokeMock.mockResolvedValue({ items: [], revision: '1:0:0:rules', total: 0 })
    const query = { limit: 100, offset: 200 }

    await querySmartPlaylist(playlistId, query)

    expect(invokeMock).toHaveBeenCalledWith('query_smart_playlist', { playlistId, query })
  })

  it('loads bounded pages and retains only the five nearest pages', async () => {
    const state = catalogState()
    const fetchPage = vi.fn(async (_playlistId: string, query: { limit: number; offset: number }) => ({
      items: Array.from({ length: query.limit }, (_, index) => item(`track-${query.offset + index}`)),
      revision: 'catalog:history:rules',
      total: 10_000,
    }))
    const pager = new SmartPlaylistPager(state, fetchPage)

    await pager.reset(playlistId)
    await pager.ensureRange(0, 799)

    expect(fetchPage).toHaveBeenLastCalledWith(playlistId, { limit: 100, offset: 700 })
    expect(Object.keys(state.pages)).toHaveLength(MAX_RETAINED_SMART_PLAYLIST_PAGES)
    expect(state.status).toBe('ready')
    expect(smartPlaylistItemAt(state, 300)?.track.id).toBe('track-300')
  })

  it('restarts at page zero when the catalog or rule revision changes', async () => {
    const state = catalogState()
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('old')], revision: 'old', total: 201 })
      .mockResolvedValueOnce({ items: [item('stale')], revision: 'new', total: 1 })
      .mockResolvedValueOnce({ items: [item('current')], revision: 'new', total: 1 })
    const pager = new SmartPlaylistPager(state, fetchPage)

    await pager.reset(playlistId)
    await pager.ensureRange(200, 200)

    expect(fetchPage).toHaveBeenLastCalledWith(playlistId, { limit: 100, offset: 0 })
    expect(state.pages['0']?.[0]?.track.id).toBe('current')
    expect(state.revision).toBe('new')
  })

  it('drops superseded selection work and reloads the visible page', async () => {
    const state = catalogState()
    let finishFirst: ((value: { items: SmartPlaylistItem[]; revision: string; total: number }) => void) | undefined
    const firstPage = new Promise<{ items: SmartPlaylistItem[]; revision: string; total: number }>((resolve) => {
      finishFirst = resolve
    })
    const fetchPage = vi.fn((id: string, query: { offset: number }) => {
      if (id === 'first') return firstPage
      return Promise.resolve({ items: [item(`${id}-${query.offset}`)], revision: id, total: 1_000 })
    })
    const pager = new SmartPlaylistPager(state, fetchPage)

    const first = pager.reset('first')
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalled())
    const second = pager.reset('second')
    finishFirst?.({ items: [item('stale')], revision: 'first', total: 1 })
    await Promise.all([first, second])
    await pager.ensureRange(700, 700)
    await pager.reload()

    expect(fetchPage).toHaveBeenLastCalledWith('second', { limit: 100, offset: 700 })
    expect(state.pages['7']?.[0]?.track.id).toBe('second-700')
    expect(state.pages['0']).toBeUndefined()
  })

  it('builds page-local playback while excluding unavailable results', () => {
    const state = catalogState()
    state.pages['0'] = [item('one'), item('offline', 'unavailable'), item('two')]

    expect(smartPlaylistPlaybackAt(state, 2)).toEqual({
      playlist: [state.pages['0'][0]?.track, state.pages['0'][2]?.track],
      playlistIndex: 1,
      song: state.pages['0'][2]?.track,
    })
    expect(smartPlaylistPlaybackAt(state, 1)).toBeUndefined()
  })

  it('reports path-free pager errors', async () => {
    const state = catalogState()
    const pager = new SmartPlaylistPager(state, async () => {
      throw { message: 'That smart playlist no longer exists.' }
    })

    await pager.reset(playlistId)

    expect(state.status).toBe('error')
    expect(state.error).toBe('That smart playlist no longer exists.')
  })
})

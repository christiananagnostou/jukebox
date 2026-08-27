import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import {
  addPlaylistEntries,
  createPlaylist,
  deletePlaylist,
  duplicatePlaylist,
  isManualPlaylistKind,
  listPlaylistEntries,
  listPlaylists,
  MAX_RETAINED_PLAYLIST_PAGES,
  movePlaylistEntry,
  playlistAt,
  PlaylistEntryPager,
  playlistPagePlaybackAt,
  PlaylistPager,
  removePlaylistEntries,
  renamePlaylist,
  type PlaylistCatalogState,
  type PlaylistEntry,
  type PlaylistSummary,
} from './playlist-client'

function catalogState<Item>(): PlaylistCatalogState<Item> {
  return { error: '', pages: {}, status: 'loading', total: 0 }
}

function playlist(id: string, name = id): PlaylistSummary {
  return {
    createdAt: '2026-08-27T00:00:00.000Z',
    entryCount: 0,
    id,
    kind: 'manual',
    name,
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
}

function entry(id: string, songId: string, availability: PlaylistEntry['availability'] = 'available'): PlaylistEntry {
  return {
    addedAt: '2026-08-27T00:00:00.000Z',
    album: 'Album',
    artist: 'Artist',
    availability,
    id,
    playlistId: 'playlist_0123456789abcdef0123456789abcdef',
    position: 0,
    songId,
    title: id,
  }
}

describe('native playlist client', () => {
  beforeEach(() => invokeMock.mockReset())

  it('uses bounded camelCase command payloads for playlist lifecycle', async () => {
    invokeMock.mockResolvedValue({ affected: 1 })
    const query = { limit: 50, offset: 100 }

    await createPlaylist('Road trip')
    await listPlaylists(query)
    await renamePlaylist('playlist_0123456789abcdef0123456789abcdef', 'Drive')
    await deletePlaylist('playlist_0123456789abcdef0123456789abcdef')
    await duplicatePlaylist('playlist_0123456789abcdef0123456789abcdef', 'Drive copy')

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'create_playlist', { name: 'Road trip' })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'list_playlists', { query })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'rename_playlist', {
      playlistId: 'playlist_0123456789abcdef0123456789abcdef',
      name: 'Drive',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'delete_playlist', {
      playlistId: 'playlist_0123456789abcdef0123456789abcdef',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(5, 'duplicate_playlist', {
      playlistId: 'playlist_0123456789abcdef0123456789abcdef',
      name: 'Drive copy',
    })
  })

  it('keeps manual entry mutations unavailable to smart or empty selections', () => {
    expect(isManualPlaylistKind('manual')).toBe(true)
    expect(isManualPlaylistKind('smart')).toBe(false)
    expect(isManualPlaylistKind('')).toBe(false)
  })

  it('addresses duplicate-safe playlist rows by stable entry ID', async () => {
    invokeMock.mockResolvedValue({ affected: 2 })
    const playlistId = 'playlist_0123456789abcdef0123456789abcdef'
    const query = { limit: 100, offset: 0 }

    await addPlaylistEntries(playlistId, ['one', 'one'])
    await listPlaylistEntries(playlistId, query)
    await removePlaylistEntries(playlistId, [
      'entry_0123456789abcdef0123456789abcdef',
      'entry_fedcba9876543210fedcba9876543210',
    ])
    await movePlaylistEntry(playlistId, 'entry_0123456789abcdef0123456789abcdef', 'down')

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'add_playlist_entries', {
      playlistId,
      songIds: ['one', 'one'],
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'list_playlist_entries', { playlistId, query })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'remove_playlist_entries', {
      playlistId,
      entryIds: ['entry_0123456789abcdef0123456789abcdef', 'entry_fedcba9876543210fedcba9876543210'],
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'move_playlist_entry', {
      direction: 'down',
      entryId: 'entry_0123456789abcdef0123456789abcdef',
      playlistId,
    })
  })

  it('loads bounded list pages and retains only nearby pages', async () => {
    const state = catalogState<PlaylistSummary>()
    const fetchPage = vi.fn(async ({ limit, offset }: { limit: number; offset: number }) => ({
      items: Array.from({ length: limit }, (_, index) => playlist(`playlist-${offset + index}`)),
      total: 10_000,
    }))
    const pager = new PlaylistPager(state, fetchPage)

    await pager.reset()
    await pager.ensureRange(0, 599)

    expect(fetchPage.mock.calls[0]?.[0]).toEqual({ limit: 50, offset: 0 })
    expect(fetchPage).toHaveBeenLastCalledWith({ limit: 50, offset: 550 })
    expect(Object.keys(state.pages)).toHaveLength(MAX_RETAINED_PLAYLIST_PAGES)
    expect(state.status).toBe('ready')
    expect(state.total).toBe(10_000)
    expect(playlistAt(state, 250)?.id).toBe('playlist-250')
  })

  it('drops queued work from a superseded playlist selection', async () => {
    const state = catalogState<PlaylistEntry>()
    const fetchPage = vi.fn(async (playlistId: string) => ({
      items: [entry(`entry-${playlistId}`, 'song-one')],
      total: 1,
    }))
    const pager = new PlaylistEntryPager(state, fetchPage)

    const first = pager.reset('playlist-one')
    const second = pager.reset('playlist-two')
    await Promise.all([first, second])

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith('playlist-two', { limit: 100, offset: 0 })
    expect(state.pages['0']?.[0]?.id).toBe('entry-playlist-two')
  })

  it('discards an in-flight page after the selected playlist changes', async () => {
    const state = catalogState<PlaylistEntry>()
    let finishFirst: ((page: { items: PlaylistEntry[]; total: number }) => void) | undefined
    const firstPage = new Promise<{ items: PlaylistEntry[]; total: number }>((resolve) => {
      finishFirst = resolve
    })
    const fetchPage = vi.fn((playlistId: string) => {
      if (playlistId === 'playlist-one') return firstPage
      return Promise.resolve({ items: [entry('entry-current', 'song-current')], total: 1 })
    })
    const pager = new PlaylistEntryPager(state, fetchPage)

    const first = pager.reset('playlist-one')
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledWith('playlist-one', { limit: 100, offset: 0 }))
    const second = pager.reset('playlist-two')
    finishFirst?.({ items: [entry('entry-stale', 'song-stale')], total: 1 })
    await Promise.all([first, second])

    expect(fetchPage).toHaveBeenLastCalledWith('playlist-two', { limit: 100, offset: 0 })
    expect(state.pages['0']?.[0]?.id).toBe('entry-current')
  })

  it('reloads the active mutation scope and reports path-free errors', async () => {
    const state = catalogState<PlaylistEntry>()
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [entry('entry-one', 'song-one')], total: 1 })
      .mockResolvedValueOnce({ items: [entry('entry-two', 'song-two')], total: 1 })
      .mockRejectedValueOnce({ message: 'That playlist no longer exists.' })
    const pager = new PlaylistEntryPager(state, fetchPage)

    await pager.reset('playlist-one')
    await pager.reload()
    expect(state.pages['0']?.[0]?.id).toBe('entry-two')
    await pager.reload()
    expect(state.status).toBe('error')
    expect(state.error).toBe('That playlist no longer exists.')
  })

  it('reloads the visible entry page after a far-down mutation', async () => {
    const state = catalogState<PlaylistEntry>()
    const fetchPage = vi.fn(async (_playlistId: string, query: { limit: number; offset: number }) => ({
      items: [entry(`entry-${query.offset}`, `song-${query.offset}`)],
      total: 10_000,
    }))
    const pager = new PlaylistEntryPager(state, fetchPage)

    await pager.reset('playlist-one')
    await pager.ensureRange(730, 760)
    await pager.reload()

    expect(fetchPage).toHaveBeenLastCalledWith('playlist-one', { limit: 100, offset: 700 })
    expect(state.pages['7']?.[0]?.id).toBe('entry-700')
    expect(state.pages['0']).toBeUndefined()
  })

  it('builds a duplicate-preserving playback context from only the loaded entry page', () => {
    const state = catalogState<PlaylistEntry>()
    state.pages['0'] = [
      entry('entry-one', 'song-a'),
      entry('entry-missing', 'song-missing', 'missing'),
      entry('entry-two', 'song-a'),
      entry('entry-unavailable', 'song-b', 'unavailable'),
      entry('entry-three', 'song-c'),
    ]

    expect(playlistPagePlaybackAt(state, 2)).toEqual({
      playlistIndex: 1,
      trackIds: ['song-a', 'song-a', 'song-c'],
    })
    expect(playlistPagePlaybackAt(state, 1)).toBeUndefined()
  })
})

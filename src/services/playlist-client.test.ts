import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import {
  addPlaylistEntries,
  createPlaylist,
  deletePlaylist,
  listPlaylistEntries,
  listPlaylists,
  removePlaylistEntries,
  renamePlaylist,
} from './playlist-client'

describe('native playlist client', () => {
  beforeEach(() => invokeMock.mockReset())

  it('uses bounded camelCase command payloads for playlist lifecycle', async () => {
    invokeMock.mockResolvedValue({ affected: 1 })
    const query = { limit: 50, offset: 100 }

    await createPlaylist('Road trip')
    await listPlaylists(query)
    await renamePlaylist('playlist_0123456789abcdef0123456789abcdef', 'Drive')
    await deletePlaylist('playlist_0123456789abcdef0123456789abcdef')

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'create_playlist', { name: 'Road trip' })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'list_playlists', { query })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'rename_playlist', {
      playlistId: 'playlist_0123456789abcdef0123456789abcdef',
      name: 'Drive',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'delete_playlist', {
      playlistId: 'playlist_0123456789abcdef0123456789abcdef',
    })
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

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'add_playlist_entries', {
      playlistId,
      songIds: ['one', 'one'],
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'list_playlist_entries', { playlistId, query })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'remove_playlist_entries', {
      playlistId,
      entryIds: ['entry_0123456789abcdef0123456789abcdef', 'entry_fedcba9876543210fedcba9876543210'],
    })
  })
})

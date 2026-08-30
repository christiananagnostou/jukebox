import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import {
  createSmartPlaylist,
  deleteSmartPlaylist,
  getSmartPlaylist,
  querySmartPlaylist,
  updateSmartPlaylist,
  type SmartPlaylistDefinition,
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
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { authorizePlaybackSource, PlaybackSourceAccessError } from './media-source'

describe('authorizePlaybackSource', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('returns only the opaque URL from exact-track native authorization', async () => {
    invokeMock.mockResolvedValue('http://127.0.0.1:49152/media/token/track-one')

    await expect(authorizePlaybackSource({ id: 'track-one' })).resolves.toBe(
      'http://127.0.0.1:49152/media/token/track-one'
    )
    expect(invokeMock).toHaveBeenCalledWith('authorize_playback_asset', { trackId: 'track-one' })
  })

  it('does not convert a path when native authorization fails', async () => {
    invokeMock.mockRejectedValue(new Error('unavailable'))

    await expect(authorizePlaybackSource({ id: 'track-one' })).rejects.toThrow('unavailable')
  })

  it('classifies the path-free native folder access error', async () => {
    invokeMock.mockRejectedValue('Music folder access is required. Reconnect the folder in Settings.')

    await expect(authorizePlaybackSource({ id: 'track-one' })).rejects.toBeInstanceOf(PlaybackSourceAccessError)
  })
})

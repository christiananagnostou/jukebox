import { beforeEach, describe, expect, it, vi } from 'vitest'

const convertFileSrcMock = vi.hoisted(() => vi.fn())
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: convertFileSrcMock, invoke: invokeMock }))

import { authorizePlaybackSource } from './media-source'

describe('authorizePlaybackSource', () => {
  beforeEach(() => {
    convertFileSrcMock.mockReset()
    invokeMock.mockReset()
  })

  it('converts only the path returned by exact-track native authorization', async () => {
    invokeMock.mockResolvedValue('/approved/library/track.flac')
    convertFileSrcMock.mockReturnValue('asset://localhost/approved/track.flac')

    await expect(authorizePlaybackSource({ id: 'track-one' })).resolves.toBe('asset://localhost/approved/track.flac')
    expect(invokeMock).toHaveBeenCalledWith('authorize_playback_asset', { trackId: 'track-one' })
    expect(convertFileSrcMock).toHaveBeenCalledWith('/approved/library/track.flac')
  })

  it('does not convert a path when native authorization fails', async () => {
    invokeMock.mockRejectedValue(new Error('unavailable'))

    await expect(authorizePlaybackSource({ id: 'track-one' })).rejects.toThrow('unavailable')
    expect(convertFileSrcMock).not.toHaveBeenCalled()
  })
})

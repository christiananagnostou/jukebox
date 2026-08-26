import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Song } from '~/App'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: vi.fn() } }))

import { clearLibrarySongs, deleteSongs, upsertSongs } from './library-db'

const song = (id: string): Song => ({
  id,
  path: `/music/${id}.flac`,
  file: `${id}.flac`,
  title: id,
  album: 'Album',
  artist: 'Artist',
  genre: '',
  bpm: 0,
  compilation: 0,
  date: '',
  encoder: '',
  trackTotal: 1,
  trackNumber: 1,
  codec: 'flac',
  duration: '0:03:00.000',
  sampleRate: '44100',
  side: 1,
  startTime: 0,
  favorRating: 0,
  dateAdded: '2026-08-26T00:00:00.000Z',
  visualsPath: '',
})

describe('library mutation wrappers', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
  })

  it('sends one logical upsert to the native transaction boundary', async () => {
    const songs = [song('one'), song('two')]

    await upsertSongs(songs)

    expect(invokeMock).toHaveBeenCalledOnce()
    expect(invokeMock).toHaveBeenCalledWith('upsert_songs', { songs })
  })

  it('sends delete and clear operations to their native boundaries', async () => {
    await deleteSongs(['one', 'two'])
    await clearLibrarySongs()

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'delete_songs', { ids: ['one', 'two'] })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'clear_library_songs')
  })

  it('does not invoke native commands for empty chunkable mutations', async () => {
    await upsertSongs([])
    await deleteSongs([])

    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('propagates native mutation failure to the caller', async () => {
    invokeMock.mockRejectedValueOnce(new Error('transaction rolled back'))

    await expect(upsertSongs([song('one')])).rejects.toThrow('transaction rolled back')
  })
})

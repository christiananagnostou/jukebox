import { describe, expect, it, vi } from 'vitest'

import type { Song } from '~/App'
import { classifyLibraryPaths, commitLibraryRemoval } from './library-maintenance'

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

describe('classifyLibraryPaths', () => {
  it('deletes only explicit missing results and retains failed checks', async () => {
    const songs = [song('present'), song('missing'), song('permission'), song('volume')]
    const checkExists = vi.fn(async (path: string) => {
      if (path.endsWith('present.flac')) return true
      if (path.endsWith('missing.flac')) return false
      if (path.endsWith('permission.flac')) throw new Error(`Permission denied: ${path}`)
      throw new Error(`Volume unavailable for ${path}`)
    })

    const result = await classifyLibraryPaths(songs, checkExists)

    expect(result.missingIds).toEqual(['missing'])
    expect(result.inaccessible.map(({ id }) => id)).toEqual(['permission', 'volume'])
    expect(result.inaccessible.map(({ message }) => message)).toEqual([
      'Permission denied: [path]',
      'Volume unavailable for [path]',
    ])
  })

  it('bounds inaccessible messages and never returns a song path', async () => {
    const inaccessible = song('private')
    const result = await classifyLibraryPaths([inaccessible], async () => {
      throw new Error(`${inaccessible.path} ${'detail '.repeat(100)}`)
    })

    expect(result.missingIds).toEqual([])
    expect(result.inaccessible[0]).toMatchObject({ id: 'private' })
    expect(result.inaccessible[0].message).not.toContain(inaccessible.path)
    expect(result.inaccessible[0].message.length).toBeLessThanOrEqual(200)
  })
})

describe('commitLibraryRemoval', () => {
  it('returns pruned library, playlist, and queue only after persistence succeeds', async () => {
    const one = song('one')
    const two = song('two')
    const collections = {
      allSongs: [one, two],
      playlist: [two, one],
      queue: [one],
    }
    const persistDeletion = vi.fn().mockResolvedValue(undefined)

    const updated = await commitLibraryRemoval(collections, ['one'], persistDeletion)

    expect(persistDeletion).toHaveBeenCalledWith(['one'])
    expect(updated.allSongs).toEqual([two])
    expect(updated.playlist).toEqual([two])
    expect(updated.queue).toEqual([])
    expect(collections.allSongs).toEqual([one, two])
    expect(collections.playlist).toEqual([two, one])
    expect(collections.queue).toEqual([one])
  })

  it('leaves every in-memory collection intact when persistence fails', async () => {
    const one = song('one')
    const two = song('two')
    const collections = {
      allSongs: [one, two],
      playlist: [two, one],
      queue: [one],
    }
    const snapshot = {
      allSongs: [...collections.allSongs],
      playlist: [...collections.playlist],
      queue: [...collections.queue],
    }

    await expect(
      commitLibraryRemoval(collections, ['one'], async () => {
        throw new Error('transaction rolled back')
      })
    ).rejects.toThrow('transaction rolled back')

    expect(collections).toEqual(snapshot)
  })
})

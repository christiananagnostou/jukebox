import { describe, expect, it } from 'vitest'

import type { Song } from '~/App'
import { compareSongsByAlbumTrack, mergeSongs } from './Songs'

const song = (overrides: Partial<Song>): Song => ({
  id: 'song',
  path: '/music/song.flac',
  file: 'song.flac',
  title: 'Song',
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
  dateAdded: '2026-08-25T00:00:00.000Z',
  visualsPath: '',
  ...overrides,
})

describe('compareSongsByAlbumTrack', () => {
  it('orders by album, side, track, title, and path', () => {
    const songs = [
      song({ id: 'b2', album: 'Beta', side: 1, trackNumber: 2 }),
      song({ id: 'a2', album: 'Alpha', side: 2, trackNumber: 1 }),
      song({ id: 'a1', album: 'Alpha', side: 1, trackNumber: 2 }),
      song({ id: 'a0', album: 'Alpha', side: 1, trackNumber: 1 }),
    ]

    expect(songs.sort(compareSongsByAlbumTrack).map(({ id }) => id)).toEqual(['a0', 'a1', 'a2', 'b2'])
  })
})

describe('mergeSongs', () => {
  it('replaces matching ids, keeps other songs, and returns default order', () => {
    const existing = [song({ id: 'two', album: 'Beta', title: 'Old title' }), song({ id: 'one', album: 'Alpha' })]
    const imported = [song({ id: 'two', album: 'Beta', title: 'New title' })]

    const merged = mergeSongs(existing, imported)

    expect(merged.map(({ id }) => id)).toEqual(['one', 'two'])
    expect(merged[1].title).toBe('New title')
  })
})

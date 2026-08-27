import { describe, expect, it } from 'vitest'

import type { Song } from '~/App'
import { getUpcomingSongs } from './Songs'

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

describe('getUpcomingSongs', () => {
  it('wraps once without repeating the current song', () => {
    const playlist = ['one', 'two', 'three'].map((id) => song({ id }))

    expect(getUpcomingSongs(playlist, 2).map(({ id }) => id)).toEqual(['one', 'two'])
  })

  it('handles empty, single-song, and stale indices', () => {
    const playlist = [song({ id: 'one' }), song({ id: 'two' })]

    expect(getUpcomingSongs([], 0)).toEqual([])
    expect(getUpcomingSongs(playlist.slice(0, 1), 0)).toEqual([])
    expect(getUpcomingSongs(playlist, 5).map(({ id }) => id)).toEqual(['one'])
  })
})

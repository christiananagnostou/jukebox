import { describe, expect, it } from 'vitest'

import type { Song } from '~/App'
import { getUpcomingSongSelections } from './Songs'

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

describe('getUpcomingSongSelections', () => {
  it('wraps once without repeating the current song', () => {
    const playlist = ['one', 'two', 'three'].map((id) => song({ id }))

    expect(getUpcomingSongSelections(playlist, 2)).toEqual([
      { contextIndex: 0, song: playlist[0] },
      { contextIndex: 1, song: playlist[1] },
    ])
  })

  it('handles empty, single-song, and stale indices', () => {
    const playlist = [song({ id: 'one' }), song({ id: 'two' })]

    expect(getUpcomingSongSelections([], 0)).toEqual([])
    expect(getUpcomingSongSelections(playlist.slice(0, 1), 0)).toEqual([])
    expect(getUpcomingSongSelections(playlist, 5)).toEqual([{ contextIndex: 0, song: playlist[0] }])
  })

  it('preserves the exact context index when track IDs repeat', () => {
    const repeated = song({ id: 'repeated' })
    const playlist = [repeated, song({ id: 'middle' }), { ...repeated }]

    expect(getUpcomingSongSelections(playlist, 1)).toEqual([
      { contextIndex: 2, song: playlist[2] },
      { contextIndex: 0, song: playlist[0] },
    ])
  })
})

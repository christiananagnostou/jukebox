import { describe, expect, it } from 'vitest'

import type { Song } from '~/App'
import {
  consumePlayedQueueHead,
  decideNextPlayback,
  decidePreviousPlayback,
  PREVIOUS_RESTART_THRESHOLD_SECONDS,
} from './playback-state'

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

describe('decideNextPlayback', () => {
  const playlist = [song('one'), song('two'), song('three')]

  it.each([
    { currentIndex: 0, expectedIndex: 1, expectedSong: 'two' },
    { currentIndex: 2, expectedIndex: 0, expectedSong: 'one' },
    { currentIndex: -1, expectedIndex: 0, expectedSong: 'one' },
    { currentIndex: 99, expectedIndex: 0, expectedSong: 'one' },
  ])('selects $expectedSong from index $currentIndex', ({ currentIndex, expectedIndex, expectedSong }) => {
    const decision = decideNextPlayback([], playlist, currentIndex)

    expect(decision).toMatchObject({
      kind: 'play',
      playlistIndex: expectedIndex,
      song: { id: expectedSong },
      source: 'playlist',
    })
  })

  it('returns none for an empty queue and playlist', () => {
    expect(decideNextPlayback([], [], 0)).toEqual({ kind: 'none' })
  })

  it('gives queue order precedence without consuming its head', () => {
    const queued = [song('queued'), song('queued')]
    const decision = decideNextPlayback(queued, playlist, 1)

    expect(decision).toMatchObject({ kind: 'play', playlistIndex: 1, song: queued[0], source: 'queue' })
    expect(queued.map(({ id }) => id)).toEqual(['queued', 'queued'])
    expect(consumePlayedQueueHead(queued, decision)).toEqual([queued[1]])
  })

  it('does not consume a queue that changed before commit', () => {
    const original = song('original')
    const decision = decideNextPlayback([original], playlist, 0)
    const replacement = song('replacement')

    expect(consumePlayedQueueHead([replacement, original], decision)).toEqual([replacement, original])
  })
})

describe('decidePreviousPlayback', () => {
  const playlist = [song('one'), song('two'), song('three')]

  it('restarts only after the ten-second threshold', () => {
    expect(decidePreviousPlayback(playlist, 1, PREVIOUS_RESTART_THRESHOLD_SECONDS + 0.1)).toEqual({ kind: 'restart' })
    expect(decidePreviousPlayback(playlist, 1, PREVIOUS_RESTART_THRESHOLD_SECONDS)).toMatchObject({
      kind: 'play',
      playlistIndex: 0,
    })
  })

  it.each([
    { currentIndex: 0, expectedIndex: 2, expectedSong: 'three' },
    { currentIndex: 2, expectedIndex: 1, expectedSong: 'two' },
    { currentIndex: -1, expectedIndex: 2, expectedSong: 'three' },
    { currentIndex: 99, expectedIndex: 2, expectedSong: 'three' },
  ])('selects $expectedSong from index $currentIndex', ({ currentIndex, expectedIndex, expectedSong }) => {
    expect(decidePreviousPlayback(playlist, currentIndex, 0)).toMatchObject({
      kind: 'play',
      playlistIndex: expectedIndex,
      song: { id: expectedSong },
      source: 'playlist',
    })
  })

  it('returns none for an empty playlist before the restart threshold', () => {
    expect(decidePreviousPlayback([], 0, 0)).toEqual({ kind: 'none' })
  })
})

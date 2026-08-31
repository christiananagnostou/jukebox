import { describe, expect, it } from 'vitest'

import type { PlaybackSource, Song } from '~/App'
import type { PlaybackSnapshot } from '~/services/playback-client'
import {
  commitPlaybackView,
  createPlaybackViewState,
  playbackTrackOccurrences,
  projectPlaybackView,
} from './playback-view'

function song(id: string, metadata: Partial<Song> = {}): Song {
  return {
    album: '',
    artist: '',
    bpm: 0,
    codec: 'flac',
    compilation: 0,
    date: '',
    dateAdded: '',
    duration: '0:03:00.000',
    encoder: '',
    favorRating: 0,
    file: `${id}.flac`,
    genre: '',
    id,
    path: `/music/${id}.flac`,
    sampleRate: '44100',
    side: 1,
    startTime: 0,
    title: id,
    trackNumber: 1,
    trackTotal: 1,
    visualsPath: '',
    ...metadata,
  }
}

function snapshot(): PlaybackSnapshot {
  return {
    canUndoQueueEdit: false,
    context: { cursor: 0, order: [0], trackIds: ['track'] },
    current: { contextIndex: 0, queueEntryId: null, resumeContextIndex: null, trackId: 'track' },
    durationMs: 180_000,
    error: null,
    history: [],
    muted: false,
    persistenceWarning: false,
    positionMs: 12_000,
    queue: [],
    repeatMode: 'off',
    revision: 1,
    schemaVersion: 1,
    shuffle: { enabled: false, seed: 1 },
    status: 'playing',
    transitionPending: false,
    volumePercent: 80,
  }
}

describe('playback view projection', () => {
  it('starts with one valid empty device view instead of index sentinels', () => {
    expect(createPlaybackViewState()).toMatchObject({
      context: [],
      current: undefined,
      currentContextIndex: null,
      queue: [],
      source: undefined,
    })
  })

  it('projects selection metadata, source, queue, and transport state together', () => {
    const current = song('track', { album: 'Amarantine', artist: 'Enya', title: "It's In The Rain" })
    const queued = song('queued', { album: 'A Day Without Rain', artist: 'Enya', title: 'Only Time' })
    const source: PlaybackSource = { kind: 'collection', label: 'Recently Played' }

    const view = projectPlaybackView(snapshot(), {
      context: [current],
      current,
      queue: [{ entryId: 'queue-1', song: queued }],
      source,
    })

    expect(view).toMatchObject({
      context: [current],
      current,
      currentContextIndex: 0,
      currentTime: 12,
      duration: 180,
      isPaused: false,
      queue: [{ entryId: 'queue-1', song: queued }],
      source,
      volumePercent: 80,
    })
  })

  it('uses the resume context for a queued occurrence and clears it when stopped', () => {
    const queuedSnapshot = snapshot()
    queuedSnapshot.current = {
      contextIndex: null,
      queueEntryId: 'queue-1',
      resumeContextIndex: 4,
      trackId: 'queued',
    }
    expect(
      projectPlaybackView(queuedSnapshot, { context: [], current: song('queued'), queue: [], source: undefined })
        .currentContextIndex
    ).toBe(4)

    queuedSnapshot.current = null
    expect(
      projectPlaybackView(queuedSnapshot, { context: [], current: undefined, queue: [], source: undefined })
        .currentContextIndex
    ).toBeNull()
  })

  it('returns every unique metadata occurrence for one track', () => {
    const shared = song('same')
    const copy = { ...shared }
    const playback = {
      ...createPlaybackViewState(),
      context: [shared, copy],
      current: shared,
      queue: [
        { entryId: 'one', song: shared },
        { entryId: 'two', song: copy },
      ],
    }

    expect(playbackTrackOccurrences(playback, 'same')).toEqual([shared, copy])
    expect(playbackTrackOccurrences(playback, 'other')).toEqual([])
  })

  it('commits into one stable reactive view boundary', () => {
    const target = createPlaybackViewState()
    const reference = target
    const current = song('track')
    const next = { ...target, context: [current], current, currentContextIndex: 0 }

    commitPlaybackView(target, next)

    expect(target).toBe(reference)
    expect(target).toMatchObject({ context: [current], current, currentContextIndex: 0 })
  })
})

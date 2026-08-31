import { describe, expect, it } from 'vitest'

import {
  MAX_QUEUE_LENGTH,
  MAX_SESSION_AGE_MILLISECONDS,
  PLAYER_SESSION_VERSION,
  appendQueue,
  clampSeekTarget,
  clearPersistedSession,
  clearQueue,
  createPersistedSession,
  createPlayerState,
  currentTrack,
  endTrack,
  loadPersistedSession,
  mediaSessionPositionState,
  nextTrack,
  parsePersistedSession,
  previousTrack,
  removeQueueOccurrence,
  replaceQueue,
  savePersistedSession,
  selectTrack,
} from './player-core.js'

const NOW = 1_800_000_000_000

const track = (id, overrides = {}) => ({
  id,
  file: `${id}.mp3`,
  title: `Track ${id}`,
  album: 'Album',
  artist: 'Artist',
  duration: '3:00',
  codec: 'mp3',
  ...overrides,
})

const persisted = (overrides = {}) => ({
  version: PLAYER_SESSION_VERSION,
  catalogRevision: '42',
  queue: [track('one'), track('two')],
  currentIndex: 0,
  positionMilliseconds: 12_000,
  savedAtMilliseconds: NOW - 1_000,
  paused: true,
  ...overrides,
})

const expectValidIndex = (state) => {
  expect(state.queue.length).toBeLessThanOrEqual(MAX_QUEUE_LENGTH)
  if (state.currentIndex === null) return
  expect(Number.isInteger(state.currentIndex)).toBe(true)
  expect(state.currentIndex).toBeGreaterThanOrEqual(0)
  expect(state.currentIndex).toBeLessThan(state.queue.length)
}

describe('private PWA player state', () => {
  it('starts empty and keeps empty transitions valid', () => {
    const empty = createPlayerState()

    expect(empty).toEqual({ queue: [], currentIndex: null })
    expect(nextTrack(empty)).toBe(empty)
    expect(previousTrack(empty)).toBe(empty)
    expect(endTrack(empty)).toBe(empty)
    expect(currentTrack(empty)).toBeNull()
  })

  it('selects the first occurrence without accepting invalid indices', () => {
    const state = replaceQueue(createPlayerState(), [track('one'), track('two')])
    const selected = selectTrack(state, 0)

    expect(selected.currentIndex).toBe(0)
    expect(currentTrack(selected)?.id).toBe('one')
    expect(selectTrack(selected, -1)).toBe(selected)
    expect(selectTrack(selected, 2)).toBe(selected)
    expect(selectTrack(selected, 0.5)).toBe(selected)
  })

  it('appends without deduplicating queue occurrences', () => {
    const initial = selectTrack(replaceQueue(createPlayerState(), [track('same')]), 0)
    const appended = appendQueue(initial, [track('same'), track('other')])

    expect(appended.queue.map(({ id }) => id)).toEqual(['same', 'same', 'other'])
    expect(appended.queue[0]).not.toBe(appended.queue[1])
    expect(appended.currentIndex).toBe(0)
  })

  it.each([
    ['next from no selection chooses the first track', nextTrack, null, 0],
    ['next advances within the queue', nextTrack, 0, 1],
    ['next stops at the final track', nextTrack, 2, 2],
    ['previous moves within the queue', previousTrack, 2, 1],
    ['previous stops at the first track', previousTrack, 0, 0],
    ['previous keeps no selection', previousTrack, null, null],
  ])('%s', (_label, transition, currentIndex, expectedIndex) => {
    const queue = [track('one'), track('two'), track('three')]
    const result = transition({ queue, currentIndex })

    expect(result.currentIndex).toBe(expectedIndex)
    expectValidIndex(result)
  })

  it('ended advances once and remains at the queue boundary', () => {
    const queue = [track('one'), track('two')]
    const advanced = endTrack({ queue, currentIndex: 0 })

    expect(advanced.currentIndex).toBe(1)
    expect(endTrack(advanced)).toBe(advanced)
  })

  it('replacement resets selection and keeps only the bounded prefix', () => {
    const previous = selectTrack(replaceQueue(createPlayerState(), [track('old')]), 0)
    const incoming = Array.from({ length: MAX_QUEUE_LENGTH + 12 }, (_, index) => track(`id_${index}`))
    const replaced = replaceQueue(previous, incoming)

    expect(replaced.queue).toHaveLength(MAX_QUEUE_LENGTH)
    expect(replaced.queue.at(-1)?.id).toBe(`id_${MAX_QUEUE_LENGTH - 1}`)
    expect(replaced.currentIndex).toBeNull()
  })

  it('append fills only remaining capacity without moving selection', () => {
    const queue = Array.from({ length: MAX_QUEUE_LENGTH - 1 }, (_, index) => track(`id_${index}`))
    const state = { queue, currentIndex: 10 }
    const appended = appendQueue(state, [track('kept'), track('dropped')])

    expect(appended.queue).toHaveLength(MAX_QUEUE_LENGTH)
    expect(appended.queue.at(-1)?.id).toBe('kept')
    expect(appended.currentIndex).toBe(10)
  })

  it('never produces an invalid index across a transition sequence', () => {
    let state = replaceQueue(createPlayerState(), [track('one'), track('two')])
    for (const transition of [nextTrack, nextTrack, nextTrack, previousTrack, endTrack]) {
      state = transition(state)
      expectValidIndex(state)
    }
    state = replaceQueue(state, [])
    expectValidIndex(state)
    expect(state.currentIndex).toBeNull()
  })

  it('removes one duplicate occurrence and preserves a later selection index', () => {
    const queue = [track('same'), track('same'), track('other')]

    expect(removeQueueOccurrence({ queue, currentIndex: 2 }, 0)).toEqual({
      queue: [queue[1], queue[2]],
      currentIndex: 1,
    })
  })

  it('repairs an unavailable current occurrence without losing the remaining queue', () => {
    const queue = [track('one'), track('two')]
    expect(removeQueueOccurrence({ queue, currentIndex: 0 }, 0)).toEqual({ queue: [queue[1]], currentIndex: null })
    expect(removeQueueOccurrence({ queue, currentIndex: 0 }, 5)).toEqual({ queue, currentIndex: 0 })
  })

  it('clears a non-empty queue without reallocating an empty state', () => {
    const empty = createPlayerState()
    expect(clearQueue(empty)).toBe(empty)
    expect(clearQueue({ queue: [track('one')], currentIndex: 0 })).toEqual(empty)
  })
})

describe('persisted private PWA sessions', () => {
  it('parses the versioned path-free shape and preserves duplicate occurrences', () => {
    const value = persisted({ queue: [track('same'), track('same')], currentIndex: 1 })

    expect(parsePersistedSession(JSON.stringify(value), '42', NOW)).toEqual(value)
  })

  it.each([
    ['malformed JSON', '{'],
    ['non-object JSON', '[]'],
    ['unknown version', persisted({ version: 2 })],
    ['invalid track ID', persisted({ queue: [track('../song')], currentIndex: 0 })],
    ['absolute file path', persisted({ queue: [track('one', { file: '/music/one.mp3' })] })],
    ['Windows file path', persisted({ queue: [track('one', { file: 'C:\\Music\\one.mp3' })] })],
    ['data URL file', persisted({ queue: [track('one', { file: 'data:audio/mpeg;base64,AAAA' })] })],
    ['path field', persisted({ queue: [{ ...track('one'), path: '/music/one.mp3' }] })],
    ['stream URL field', persisted({ queue: [{ ...track('one'), streamUrl: '/api/tracks/one/stream' }] })],
    ['out-of-range current index', persisted({ currentIndex: 2 })],
    ['negative current index', persisted({ currentIndex: -1 })],
    ['position without a selection', persisted({ currentIndex: null, positionMilliseconds: 1 })],
    ['fractional position', persisted({ positionMilliseconds: 1.5 })],
    ['negative position', persisted({ positionMilliseconds: -1 })],
    ['non-finite position', persisted({ positionMilliseconds: Number.POSITIVE_INFINITY })],
    ['autoplay restore state', persisted({ paused: false })],
    ['missing saved timestamp', { ...persisted(), savedAtMilliseconds: undefined }],
    ['unknown session field', { ...persisted(), source: '/api/tracks/one/stream' }],
  ])('rejects %s', (_label, value) => {
    expect(parsePersistedSession(value, '42', NOW)).toBeNull()
  })

  it('rejects persisted queues over the bound instead of truncating them', () => {
    const queue = Array.from({ length: MAX_QUEUE_LENGTH + 1 }, (_, index) => track(`id_${index}`))

    expect(parsePersistedSession(persisted({ queue }), '42', NOW)).toBeNull()
  })

  it('rejects a stale catalog revision so the caller can recover with a fresh session', () => {
    expect(parsePersistedSession(persisted(), '43', NOW)).toBeNull()
    expect(parsePersistedSession(persisted(), '42', NOW)?.catalogRevision).toBe('42')
  })

  it('keeps a path-free display filename containing a colon', () => {
    expect(
      parsePersistedSession(persisted({ queue: [track('one', { file: 'Track:One.mp3' })] }), '42', NOW)
    ).not.toBeNull()
  })

  it('rejects expired and implausibly future sessions', () => {
    expect(
      parsePersistedSession(persisted({ savedAtMilliseconds: NOW - MAX_SESSION_AGE_MILLISECONDS - 1 }), '42', NOW)
    ).toBeNull()
    expect(parsePersistedSession(persisted({ savedAtMilliseconds: NOW + 5 * 60 * 1000 + 1 }), '42', NOW)).toBeNull()
  })

  it('creates only a paused, whole-millisecond session', () => {
    const state = { queue: [track('one')], currentIndex: 0 }
    expect(createPersistedSession(state, '42', 12_000, NOW)).toEqual(
      persisted({ queue: state.queue, positionMilliseconds: 12_000, savedAtMilliseconds: NOW })
    )
    expect(createPersistedSession(state, '42', 12.5, NOW)).toBeNull()
  })

  it('loads, saves, and clears through a storage boundary', () => {
    const values = new Map()
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }
    const session = persisted()

    expect(savePersistedSession(storage, 'session', session)).toBe(true)
    expect(loadPersistedSession(storage, 'session', null, NOW)).toEqual(session)
    expect(loadPersistedSession(storage, 'session', '42', NOW)).toEqual(session)
    expect(clearPersistedSession(storage, 'session')).toBe(true)
    expect(loadPersistedSession(storage, 'session', '42', NOW)).toBeNull()
  })

  it('discards malformed or stale storage without throwing', () => {
    let value = '{'
    let removed = 0
    const storage = {
      getItem: () => value,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        removed += 1
        value = null
      },
    }

    expect(loadPersistedSession(storage, 'session', '42', NOW)).toBeNull()
    expect(removed).toBe(1)
    expect(savePersistedSession(storage, 'session', persisted())).toBe(false)
    expect(savePersistedSession(storage, 'session', null)).toBe(false)
  })

  it('contains storage access failures', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }

    expect(loadPersistedSession(storage, 'session', '42', NOW)).toBeNull()
    expect(savePersistedSession(storage, 'session', persisted())).toBe(false)
    expect(clearPersistedSession(storage, 'session')).toBe(false)
  })
})

describe('private PWA seek helpers', () => {
  it.each([
    ['negative target', -10, 120, 0],
    ['interior target', 30, 120, 30],
    ['past duration', 200, 120, 120],
    ['zero duration', 10, 0, null],
    ['unknown target', Number.NaN, 120, null],
    ['unknown duration', 10, Number.POSITIVE_INFINITY, null],
  ])('clamps %s', (_label, target, duration, expected) => {
    expect(clampSeekTarget(target, duration)).toBe(expected)
  })

  it('derives Media Session position state only from valid finite values', () => {
    expect(mediaSessionPositionState(120, 30, 1.25)).toEqual({ duration: 120, position: 30, playbackRate: 1.25 })
    expect(mediaSessionPositionState(0, 0)).toBeNull()
    expect(mediaSessionPositionState(120, -1)).toBeNull()
    expect(mediaSessionPositionState(120, 121)).toBeNull()
    expect(mediaSessionPositionState(120, 30, 0)).toBeNull()
    expect(mediaSessionPositionState(Number.NaN, 30)).toBeNull()
  })
})

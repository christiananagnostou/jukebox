export const MAX_QUEUE_LENGTH = 500
export const PLAYER_SESSION_VERSION = 1
export const MAX_SESSION_AGE_MILLISECONDS = 30 * 24 * 60 * 60 * 1000

const MAX_TRACK_ID_LENGTH = 128
const MAX_DISPLAY_LENGTH = 1024
const MAX_FILE_LENGTH = 512
const MAX_DURATION_LENGTH = 64
const MAX_POSITION_MILLISECONDS = Number.MAX_SAFE_INTEGER
const MAX_FUTURE_CLOCK_SKEW_MILLISECONDS = 5 * 60 * 1000
const TRACK_FIELDS = new Set(['id', 'file', 'title', 'album', 'artist', 'duration', 'codec'])
const SESSION_FIELDS = new Set([
  'version',
  'catalogRevision',
  'queue',
  'currentIndex',
  'positionMilliseconds',
  'savedAtMilliseconds',
  'paused',
])

/**
 * @typedef {object} PlayerTrack
 * @property {string} id
 * @property {string} file
 * @property {string} title
 * @property {string} album
 * @property {string} artist
 * @property {string} duration
 * @property {string} codec
 */

/**
 * @typedef {object} PlayerState
 * @property {PlayerTrack[]} queue
 * @property {number | null} currentIndex
 */

/**
 * @typedef {object} PersistedPlayerSession
 * @property {1} version
 * @property {string} catalogRevision
 * @property {PlayerTrack[]} queue
 * @property {number | null} currentIndex
 * @property {number} positionMilliseconds
 * @property {number} savedAtMilliseconds
 * @property {true} paused
 */

/** @returns {PlayerState} */
export const createPlayerState = () => ({ queue: [], currentIndex: null })

/**
 * Replace the device-local queue. Incoming catalog pages are truncated to the
 * session bound; persisted oversized queues are rejected by the parser below.
 *
 * @param {PlayerState} state
 * @param {unknown[]} tracks
 * @returns {PlayerState}
 */
export const replaceQueue = (state, tracks) => {
  assertPlayerState(state)
  if (!Array.isArray(tracks)) throw new TypeError('The playback queue must be an array.')
  return {
    queue: tracks.slice(0, MAX_QUEUE_LENGTH).map(normalizeTrack),
    currentIndex: null,
  }
}

/**
 * Append catalog rows without allowing the retained queue to exceed its bound.
 * Duplicate IDs remain distinct entries and preserve their occurrence order.
 *
 * @param {PlayerState} state
 * @param {unknown[]} tracks
 * @returns {PlayerState}
 */
export const appendQueue = (state, tracks) => {
  assertPlayerState(state)
  if (!Array.isArray(tracks)) throw new TypeError('The playback queue must be an array.')
  const available = MAX_QUEUE_LENGTH - state.queue.length
  if (available <= 0 || tracks.length === 0) return state
  return {
    queue: [...state.queue, ...tracks.slice(0, available).map(normalizeTrack)],
    currentIndex: state.currentIndex,
  }
}

/**
 * @param {PlayerState} state
 * @param {number} index
 * @returns {PlayerState}
 */
export const selectTrack = (state, index) => {
  assertPlayerState(state)
  if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return state
  if (state.currentIndex === index) return state
  return { queue: state.queue, currentIndex: index }
}

/** @param {PlayerState} state @returns {PlayerState} */
export const nextTrack = (state) => {
  assertPlayerState(state)
  if (state.queue.length === 0) return state
  if (state.currentIndex === null) return { queue: state.queue, currentIndex: 0 }
  return selectTrack(state, state.currentIndex + 1)
}

/** @param {PlayerState} state @returns {PlayerState} */
export const previousTrack = (state) => {
  assertPlayerState(state)
  if (state.currentIndex === null) return state
  return selectTrack(state, state.currentIndex - 1)
}

/** @param {PlayerState} state @returns {PlayerState} */
export const endTrack = (state) => nextTrack(state)

/**
 * Remove one queue occurrence without conflating duplicate track IDs. Removing
 * the selected occurrence clears selection so the caller can choose whether to
 * stop, skip, or wait for another explicit activation.
 *
 * @param {PlayerState} state
 * @param {number} index
 * @returns {PlayerState}
 */
export const removeQueueOccurrence = (state, index) => {
  assertPlayerState(state)
  if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return state
  const queue = [...state.queue.slice(0, index), ...state.queue.slice(index + 1)]
  const currentIndex =
    state.currentIndex === null || state.currentIndex === index
      ? null
      : state.currentIndex > index
        ? state.currentIndex - 1
        : state.currentIndex
  return { queue, currentIndex }
}

/** @param {PlayerState} state @returns {PlayerState} */
export const clearQueue = (state) => {
  assertPlayerState(state)
  return state.queue.length === 0 ? state : createPlayerState()
}

/** @param {PlayerState} state @returns {PlayerTrack | null} */
export const currentTrack = (state) => {
  assertPlayerState(state)
  return state.currentIndex === null ? null : state.queue[state.currentIndex]
}

/**
 * Parse the versioned shape reserved for plan 059 persistence. The parser is
 * deliberately usable before storage exists so its security and recovery
 * behavior cannot be invented alongside the persistence side effect.
 *
 * @param {unknown} value
 * @param {string | null} [expectedCatalogRevision]
 * @param {number} [nowMilliseconds]
 * @returns {PersistedPlayerSession | null}
 */
export const parsePersistedSession = (value, expectedCatalogRevision = null, nowMilliseconds = Date.now()) => {
  let candidate = value
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!isRecord(candidate) || !hasOnlyFields(candidate, SESSION_FIELDS)) return null
  if (candidate.version !== PLAYER_SESSION_VERSION) return null
  if (!isCatalogRevision(candidate.catalogRevision)) return null
  if (expectedCatalogRevision !== null && candidate.catalogRevision !== expectedCatalogRevision) return null
  if (!Array.isArray(candidate.queue) || candidate.queue.length > MAX_QUEUE_LENGTH) return null

  let queue
  try {
    queue = candidate.queue.map(normalizeTrack)
  } catch {
    return null
  }

  const currentIndex = candidate.currentIndex
  if (currentIndex !== null && (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= queue.length)) {
    return null
  }
  if (queue.length === 0 && currentIndex !== null) return null

  const positionMilliseconds = candidate.positionMilliseconds
  if (
    !Number.isSafeInteger(positionMilliseconds) ||
    positionMilliseconds < 0 ||
    positionMilliseconds > MAX_POSITION_MILLISECONDS ||
    (currentIndex === null && positionMilliseconds !== 0)
  ) {
    return null
  }

  const savedAtMilliseconds = candidate.savedAtMilliseconds
  if (
    !Number.isSafeInteger(savedAtMilliseconds) ||
    savedAtMilliseconds < 0 ||
    !Number.isFinite(nowMilliseconds) ||
    savedAtMilliseconds > nowMilliseconds + MAX_FUTURE_CLOCK_SKEW_MILLISECONDS ||
    nowMilliseconds - savedAtMilliseconds > MAX_SESSION_AGE_MILLISECONDS
  ) {
    return null
  }
  if (candidate.paused !== true) return null

  return {
    version: PLAYER_SESSION_VERSION,
    catalogRevision: candidate.catalogRevision,
    queue,
    currentIndex,
    positionMilliseconds,
    savedAtMilliseconds,
    paused: true,
  }
}

/**
 * @param {PlayerState} state
 * @param {string} catalogRevision
 * @param {number} positionMilliseconds
 * @param {number} savedAtMilliseconds
 * @returns {PersistedPlayerSession | null}
 */
export const createPersistedSession = (state, catalogRevision, positionMilliseconds, savedAtMilliseconds) =>
  parsePersistedSession(
    {
      version: PLAYER_SESSION_VERSION,
      catalogRevision,
      queue: state.queue,
      currentIndex: state.currentIndex,
      positionMilliseconds,
      savedAtMilliseconds,
      paused: true,
    },
    catalogRevision,
    savedAtMilliseconds
  )

/**
 * @param {{ getItem: (key: string) => string | null, removeItem: (key: string) => void }} storage
 * @param {string} key
 * @param {string | null} expectedCatalogRevision
 * @param {number} [nowMilliseconds]
 * @returns {PersistedPlayerSession | null}
 */
export const loadPersistedSession = (storage, key, expectedCatalogRevision, nowMilliseconds = Date.now()) => {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const parsed = parsePersistedSession(raw, expectedCatalogRevision, nowMilliseconds)
    if (parsed) return parsed
    storage.removeItem(key)
  } catch {
    return null
  }
  return null
}

/**
 * @param {{ setItem: (key: string, value: string) => void }} storage
 * @param {string} key
 * @param {PersistedPlayerSession} session
 * @returns {boolean}
 */
export const savePersistedSession = (storage, key, session) => {
  if (!isRecord(session)) return false
  if (!parsePersistedSession(session, session.catalogRevision, session.savedAtMilliseconds)) return false
  try {
    storage.setItem(key, JSON.stringify(session))
    return true
  } catch {
    return false
  }
}

/**
 * @param {{ removeItem: (key: string) => void }} storage
 * @param {string} key
 * @returns {boolean}
 */
export const clearPersistedSession = (storage, key) => {
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * @param {number} target
 * @param {number} duration
 * @returns {number | null}
 */
export const clampSeekTarget = (target, duration) => {
  if (!Number.isFinite(target) || !Number.isFinite(duration) || duration <= 0) return null
  return Math.min(Math.max(target, 0), duration)
}

/**
 * @param {number} duration
 * @param {number} position
 * @param {number} [playbackRate]
 * @returns {{ duration: number, position: number, playbackRate: number } | null}
 */
export const mediaSessionPositionState = (duration, position, playbackRate = 1) => {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(position) ||
    position < 0 ||
    position > duration ||
    !Number.isFinite(playbackRate) ||
    playbackRate <= 0
  ) {
    return null
  }
  return { duration, position, playbackRate }
}

/** @param {unknown} value @returns {PlayerTrack} */
const normalizeTrack = (value) => {
  if (!isRecord(value) || !hasOnlyFields(value, TRACK_FIELDS)) throw new TypeError('Invalid playback track.')
  if (!isTrackId(value.id)) throw new TypeError('Invalid playback track identifier.')

  const file = displayString(value.file, MAX_FILE_LENGTH)
  if (file.includes('/') || file.includes('\\') || /^(blob|data):/i.test(file)) {
    throw new TypeError('Playback state cannot contain a file path or URL.')
  }

  return {
    id: value.id,
    file,
    title: displayString(value.title, MAX_DISPLAY_LENGTH),
    album: displayString(value.album, MAX_DISPLAY_LENGTH),
    artist: displayString(value.artist, MAX_DISPLAY_LENGTH),
    duration: displayString(value.duration, MAX_DURATION_LENGTH),
    codec: displayString(value.codec, MAX_DURATION_LENGTH),
  }
}

/** @param {PlayerState} state */
const assertPlayerState = (state) => {
  if (!isRecord(state) || !Array.isArray(state.queue)) throw new TypeError('Invalid player state.')
  if (state.queue.length > MAX_QUEUE_LENGTH) throw new TypeError('The playback queue exceeds its bound.')
  if (
    state.currentIndex !== null &&
    (!Number.isInteger(state.currentIndex) || state.currentIndex < 0 || state.currentIndex >= state.queue.length)
  ) {
    throw new TypeError('The current playback index is invalid.')
  }
}

/** @param {unknown} value @param {number} maximum @returns {string} */
const displayString = (value, maximum) => {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Invalid playback display metadata.')
  }
  return value
}

/** @param {unknown} value @returns {boolean} */
const isTrackId = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TRACK_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)

/** @param {unknown} value @returns {boolean} */
const isCatalogRevision = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= 64 && /^\d+$/.test(value)

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** @param {Record<string, unknown>} value @param {Set<string>} fields @returns {boolean} */
const hasOnlyFields = (value, fields) => Object.keys(value).every((key) => fields.has(key))

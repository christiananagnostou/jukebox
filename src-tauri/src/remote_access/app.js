import {
  MAX_QUEUE_LENGTH,
  clampSeekTarget,
  clearPersistedSession,
  clearQueue,
  createPersistedSession,
  createPlayerState,
  currentTrack as getCurrentTrack,
  endTrack,
  loadPersistedSession,
  mediaSessionPositionState,
  nextTrack,
  previousTrack,
  removeQueueOccurrence,
  replaceQueue,
  savePersistedSession,
  selectTrack,
} from './player-core.js'

const PAGE_SIZE = 50
const MAX_VISIBLE_QUEUE_ITEMS = 20
const POSITION_CHECKPOINT_MILLISECONDS = 5_000
const MEDIA_POSITION_UPDATE_MILLISECONDS = 1_000
const PROBE_TIMEOUT_MILLISECONDS = 5_000
const SESSION_STORAGE_KEY = 'jukebox.private-player.session'

const form = document.querySelector('#search-form')
const input = document.querySelector('#search')
const player = document.querySelector('#player')
const status = document.querySelector('#status')
const libraryRetry = document.querySelector('#library-retry')
const items = document.querySelector('#items')
const loadMore = document.querySelector('#load-more')
const back = document.querySelector('#back')
const context = document.querySelector('#context')
const contextLabel = document.querySelector('#context-label')
const nowPlaying = document.querySelector('#now-playing')
const nowPlayingDetail = document.querySelector('#now-playing-detail')
const playbackStatus = document.querySelector('#playback-status')
const playbackActions = document.querySelector('#playback-actions')
const queueCount = document.querySelector('#queue-count')
const queueItems = document.querySelector('#queue-items')
const clearQueueButton = document.querySelector('#clear-queue')
const viewButtons = [...document.querySelectorAll('[data-view]')]

let view = 'tracks'
let artist = ''
let album = ''
let cursor = ''
let offset = 0
let total = 0
let revision = ''
let generation = 0
let browseTracks = []
let playback = createPlayerState()
let playbackRevision = ''
let endedHandled = false
let playbackError = false
let activeTrack = null
let restoreValidationPending = false
let lastCheckpointBucket = -1
let lastMediaPositionBucket = -1

const detail = (values, fallback) => values.filter(Boolean).join(' · ') || fallback

const storage = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const runTransport = (operation) => {
  Promise.resolve()
    .then(operation)
    .catch(() => showPlaybackFeedback('This track could not be played.', [{ label: 'Retry', action: retrySelected }]))
}

const actionButton = ({ label, action, danger = false }) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = danger ? 'quiet-action danger-action' : 'quiet-action'
  button.textContent = label
  button.addEventListener('click', () => runTransport(action))
  return button
}

const showPlaybackFeedback = (message, actions = []) => {
  playbackStatus.textContent = message
  playbackActions.replaceChildren(...actions.map(actionButton))
}

const setLibraryStatus = (message, retry = false) => {
  status.textContent = message
  libraryRetry.hidden = !retry
}

const updateNavigation = () => {
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === view))
  const drilledDown = Boolean(artist || album)
  context.hidden = !drilledDown
  contextLabel.textContent = album ? detail([album, artist], 'Album') : artist
  input.placeholder = view === 'artists' ? 'Search artists' : view === 'albums' ? 'Search albums' : 'Search tracks'
  items.setAttribute('aria-label', view[0].toUpperCase() + view.slice(1))
}

const setMediaMetadata = (track) => {
  if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) return
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || track.file,
      artist: track.artist,
      album: track.album,
    })
  } catch {
    // Media metadata is an enhancement; audio remains available without it.
  }
}

const updateMediaPlaybackState = () => {
  if (!('mediaSession' in navigator)) return
  try {
    navigator.mediaSession.playbackState = player.paused ? 'paused' : 'playing'
  } catch {
    // Older WebKit versions may expose Media Session without playbackState.
  }
}

const updateMediaPosition = () => {
  if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return
  const positionState = mediaSessionPositionState(player.duration, player.currentTime, player.playbackRate)
  if (!positionState) return
  try {
    navigator.mediaSession.setPositionState(positionState)
  } catch {
    // Older WebKit versions may reject position state while metadata changes.
  }
}

const updatePlayingCopy = (track) => {
  if (!track) {
    nowPlaying.textContent = 'Nothing playing'
    nowPlayingDetail.textContent = playback.queue.length ? 'Choose a queued track.' : 'Choose a track to begin.'
    return
  }
  nowPlaying.textContent = track.title || track.file
  nowPlayingDetail.textContent = detail([track.artist, track.album], 'Unknown artist')
}

const checkpointSession = () => {
  const deviceStorage = storage()
  if (!deviceStorage) return false
  if (!playback.queue.length || !playbackRevision) {
    clearPersistedSession(deviceStorage, SESSION_STORAGE_KEY)
    return false
  }
  const positionMilliseconds =
    playback.currentIndex === null || !Number.isFinite(player.currentTime)
      ? 0
      : Math.max(0, Math.round(player.currentTime * 1_000))
  const session = createPersistedSession(playback, playbackRevision, positionMilliseconds, Date.now())
  return session ? savePersistedSession(deviceStorage, SESSION_STORAGE_KEY, session) : false
}

const queueIndices = () => {
  if (!playback.queue.length) return []
  const start = playback.currentIndex ?? 0
  const end = Math.min(playback.queue.length, start + MAX_VISIBLE_QUEUE_ITEMS + 1)
  return Array.from({ length: end - start }, (_, index) => start + index)
}

const removeAt = (index) => {
  const removingCurrent = playback.currentIndex === index
  playback = removeQueueOccurrence(playback, index)
  if (removingCurrent) {
    player.pause()
    player.removeAttribute('src')
    player.load()
    activeTrack = null
    playbackError = false
    updatePlayingCopy(null)
    showPlaybackFeedback(playback.queue.length ? 'Track removed. Choose what plays next.' : 'Queue empty.')
  }
  renderQueue()
  checkpointSession()
}

const renderQueue = () => {
  const count = playback.queue.length
  queueCount.textContent = count ? `${count} track${count === 1 ? '' : 's'}` : 'Queue empty'
  clearQueueButton.hidden = count === 0
  if (!count) {
    const empty = document.createElement('p')
    empty.className = 'queue-empty'
    empty.textContent = 'Play a track to build this device queue.'
    queueItems.replaceChildren(empty)
    return
  }

  const rows = queueIndices().map((index) => {
    const track = playback.queue[index]
    const row = document.createElement('div')
    row.className = 'queue-row'
    if (index === playback.currentIndex) row.classList.add('is-current')

    const activate = document.createElement('button')
    activate.type = 'button'
    activate.className = 'queue-track'
    activate.setAttribute('aria-current', index === playback.currentIndex ? 'true' : 'false')
    const title = document.createElement('strong')
    title.textContent = track.title || track.file
    const secondary = document.createElement('span')
    secondary.textContent = detail([track.artist, index === playback.currentIndex ? 'Current' : 'Upcoming'], 'Upcoming')
    activate.append(title, secondary)
    activate.addEventListener('click', () => runTransport(() => playAt(index)))

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'queue-remove'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove ${track.title || track.file} from queue`)
    remove.addEventListener('click', () => removeAt(index))
    row.append(activate, remove)
    return row
  })
  queueItems.replaceChildren(...rows)
}

const clearDeviceQueue = () => {
  player.pause()
  player.removeAttribute('src')
  player.load()
  playback = clearQueue(playback)
  activeTrack = null
  playbackError = false
  playbackRevision = ''
  updatePlayingCopy(null)
  renderQueue()
  const deviceStorage = storage()
  if (deviceStorage) clearPersistedSession(deviceStorage, SESSION_STORAGE_KEY)
  showPlaybackFeedback('Queue empty.')
}

const selectedTrackLabel = () => (activeTrack ? activeTrack.title || activeTrack.file : 'this track')

const playSelected = async () => {
  if (!activeTrack) return false
  try {
    await player.play()
    return true
  } catch {
    playbackError = true
    showPlaybackFeedback('Tap play to start audio.', [{ label: 'Play', action: playSelected }])
    return false
  }
}

const retrySelected = async () => {
  if (!activeTrack) return false
  player.load()
  return playSelected()
}

const seekTo = (target) => {
  const next = clampSeekTarget(target, player.duration)
  if (next === null) return false
  try {
    player.currentTime = next
    updateMediaPosition()
    checkpointSession()
    return true
  } catch {
    return false
  }
}

const setPlayerSource = (track, positionMilliseconds = 0) => {
  activeTrack = track
  endedHandled = false
  playbackError = false
  lastCheckpointBucket = -1
  lastMediaPositionBucket = -1
  player.src = `/api/tracks/${encodeURIComponent(track.id)}/stream`
  if (positionMilliseconds > 0) {
    player.addEventListener(
      'loadedmetadata',
      () => {
        const seconds = clampSeekTarget(positionMilliseconds / 1_000, player.duration)
        if (seconds !== null) player.currentTime = seconds
        updateMediaPosition()
      },
      { once: true }
    )
  }
  updatePlayingCopy(track)
  setMediaMetadata(track)
  renderQueue()
}

const playAt = async (index, { fromEnded = false } = {}) => {
  const selected = selectTrack(playback, index)
  if (selected === playback && playback.currentIndex !== index) return false
  playback = selected
  const track = getCurrentTrack(playback)
  if (!track) return false
  if (!fromEnded) endedHandled = false
  setPlayerSource(track)
  checkpointSession()
  return playSelected()
}

const playAdjacent = async (transition, options) => {
  const next = transition(playback)
  if (next === playback || next.currentIndex === null) return false
  await playAt(next.currentIndex, options)
  return true
}

const skipUnavailable = async () => {
  const advanced = await playAdjacent(nextTrack)
  if (!advanced) {
    showPlaybackFeedback('End of queue.', [
      { label: 'Remove', action: () => removeAt(playback.currentIndex), danger: true },
    ])
  }
}

const probeTrack = async (track) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MILLISECONDS)
  try {
    const response = await fetch(`/api/tracks/${encodeURIComponent(track.id)}/stream`, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (response.status === 404) return 'unavailable'
    return response.ok ? 'available' : 'network'
  } catch {
    return 'network'
  } finally {
    window.clearTimeout(timeout)
  }
}

const classifyPlaybackFailure = async (track) => {
  const selectedTrack = activeTrack
  const selectedIndex = playback.currentIndex
  const availability = await probeTrack(track)
  if (selectedTrack !== activeTrack || selectedIndex !== playback.currentIndex) return
  if (availability === 'unavailable') {
    showPlaybackFeedback('Track unavailable.', [
      { label: 'Skip', action: skipUnavailable },
      { label: 'Remove', action: () => removeAt(playback.currentIndex), danger: true },
    ])
    return
  }
  showPlaybackFeedback(navigator.onLine ? 'Audio was interrupted.' : 'You are offline.', [
    { label: 'Retry', action: retrySelected },
  ])
}

const restoreDeviceSession = () => {
  const deviceStorage = storage()
  if (!deviceStorage) return
  const session = loadPersistedSession(deviceStorage, SESSION_STORAGE_KEY, null)
  if (!session) return

  playback = { queue: session.queue, currentIndex: session.currentIndex }
  playbackRevision = session.catalogRevision
  restoreValidationPending = true
  const track = getCurrentTrack(playback)
  if (!track) {
    updatePlayingCopy(null)
    showPlaybackFeedback('Queue restored. Choose a track to continue.')
    return
  }

  setPlayerSource(track, session.positionMilliseconds)
  showPlaybackFeedback('Ready. Tap play to continue.', [{ label: 'Play', action: playSelected }])
}

const validateRestoredSession = async (catalogRevision) => {
  if (!restoreValidationPending) return
  restoreValidationPending = false
  if (playbackRevision !== catalogRevision) {
    clearDeviceQueue()
    showPlaybackFeedback('The library changed, so the saved queue was cleared.')
    return
  }

  const track = getCurrentTrack(playback)
  if (!track) return

  const availability = await probeTrack(track)
  if (availability === 'unavailable') {
    playback = removeQueueOccurrence(playback, playback.currentIndex)
    activeTrack = null
    updatePlayingCopy(null)
    renderQueue()
    checkpointSession()
    showPlaybackFeedback(
      playback.queue.length
        ? 'An unavailable saved track was removed. Choose what plays next.'
        : 'Saved track unavailable.'
    )
    return
  }
  if (availability === 'network') {
    showPlaybackFeedback(
      navigator.onLine
        ? 'Saved track did not respond. Retry when it is available.'
        : 'Queue restored offline. Reconnect, then retry.',
      [{ label: 'Retry', action: retrySelected }]
    )
  }
}

const itemButton = (primary, secondary, onClick) => {
  const button = document.createElement('button')
  button.className = 'item'
  const title = document.createElement('strong')
  title.textContent = primary
  const description = document.createElement('span')
  description.textContent = secondary
  button.append(title, description)
  button.addEventListener('click', onClick)
  return button
}

const renderTracks = (tracks, append) => {
  const start = append ? browseTracks.length : 0
  browseTracks = append
    ? [...browseTracks, ...tracks.slice(0, MAX_QUEUE_LENGTH - browseTracks.length)]
    : tracks.slice(0, MAX_QUEUE_LENGTH)
  browseTracks.slice(start).forEach((track, index) => {
    items.append(
      itemButton(
        track.title || track.file,
        detail([track.artist, track.album, track.duration], 'Unknown artist'),
        () => {
          playback = replaceQueue(playback, browseTracks)
          playbackRevision = revision
          runTransport(() => playAt(start + index))
        }
      )
    )
  })
}

const renderArtists = (artists) => {
  for (const item of artists) {
    items.append(
      itemButton(
        item.name,
        `${item.albumCount} album${item.albumCount === 1 ? '' : 's'} · ${item.trackCount} track${item.trackCount === 1 ? '' : 's'}`,
        () => {
          view = 'albums'
          artist = item.value
          album = ''
          input.value = ''
          load()
        }
      )
    )
  }
}

const renderAlbums = (albums) => {
  for (const item of albums) {
    items.append(
      itemButton(item.name, detail([item.artist, item.date, `${item.trackCount} tracks`], 'Unknown artist'), () => {
        view = 'tracks'
        artist = item.artistValue
        album = item.value
        input.value = ''
        load()
      })
    )
  }
}

const requestUrl = () => {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), q: input.value })
  if (view === 'tracks') {
    if (cursor) params.set('cursor', cursor)
    if (artist) params.set('artist', artist)
    if (album) params.set('album', album)
  } else {
    params.set('offset', String(offset))
    if (view === 'albums' && artist) params.set('artist', artist)
  }
  return `/api/${view}?${params}`
}

const load = async ({ append = false } = {}) => {
  if (!append) {
    cursor = ''
    offset = 0
    total = 0
    revision = ''
    if (view === 'tracks') browseTracks = []
    items.replaceChildren()
  }
  updateNavigation()
  const requestGeneration = ++generation
  setLibraryStatus(append ? 'Loading more…' : `Loading ${view}…`)
  loadMore.hidden = true
  try {
    const response = await fetch(requestUrl())
    if (requestGeneration !== generation) return
    if (response.status === 409 && append) return load()
    if (!response.ok) throw new Error('Library request failed')
    const body = await response.json()
    if (requestGeneration !== generation) return
    if (view === 'tracks') {
      revision = response.headers.get('x-jukebox-catalog-revision') || ''
      renderTracks(body, append)
      cursor = response.headers.get('x-jukebox-next-cursor') || ''
      offset += body.length
      total = offset
      loadMore.hidden = !cursor || browseTracks.length >= MAX_QUEUE_LENGTH
      await validateRestoredSession(revision)
    } else {
      if (append && revision && revision !== String(body.revision)) return load()
      if (view === 'artists') renderArtists(body.items)
      else renderAlbums(body.items)
      offset += body.items.length
      total = body.total
      revision = String(body.revision)
      loadMore.hidden = offset >= total
    }
    setLibraryStatus(
      offset
        ? view === 'tracks'
          ? `${offset}${cursor ? '+' : ''} tracks`
          : `${offset}${offset < total ? ` of ${total}` : ''} ${view}`
        : `No matching ${view}`
    )
  } catch (error) {
    setLibraryStatus(error instanceof Error ? error.message : 'Could not load the library', true)
  }
}

for (const button of viewButtons) {
  button.addEventListener('click', () => {
    view = button.dataset.view
    artist = ''
    album = ''
    input.value = ''
    load()
  })
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  load()
})
libraryRetry.addEventListener('click', () => load())
loadMore.addEventListener('click', () => load({ append: true }))
clearQueueButton.addEventListener('click', clearDeviceQueue)
back.addEventListener('click', () => {
  if (album) {
    view = 'albums'
    album = ''
  } else {
    view = 'artists'
    artist = ''
  }
  input.value = ''
  load()
})

player.addEventListener('error', () => {
  playbackError = true
  if (activeTrack) runTransport(() => classifyPlaybackFailure(activeTrack))
})
player.addEventListener('stalled', () => {
  showPlaybackFeedback('Audio stalled. Waiting to recover…', [{ label: 'Retry', action: retrySelected }])
})
player.addEventListener('waiting', () => {
  showPlaybackFeedback('Buffering audio…')
})
player.addEventListener('playing', () => {
  endedHandled = false
  playbackError = false
  showPlaybackFeedback(`Playing ${selectedTrackLabel()}.`)
  updateMediaPlaybackState()
  updateMediaPosition()
})
player.addEventListener('pause', () => {
  updateMediaPlaybackState()
  checkpointSession()
  if (!playbackError && !player.ended && player.currentSrc) {
    showPlaybackFeedback('Paused. Tap play to continue.', [{ label: 'Play', action: playSelected }])
  }
})
player.addEventListener('ended', () => {
  if (endedHandled) return
  endedHandled = true
  runTransport(async () => {
    const advanced = await playAdjacent(endTrack, { fromEnded: true })
    if (!advanced) showPlaybackFeedback('End of queue.')
  })
})
player.addEventListener('durationchange', updateMediaPosition)
player.addEventListener('timeupdate', () => {
  const positionMilliseconds = Math.max(0, Math.floor(player.currentTime * 1_000))
  const mediaBucket = Math.floor(positionMilliseconds / MEDIA_POSITION_UPDATE_MILLISECONDS)
  if (mediaBucket !== lastMediaPositionBucket) {
    lastMediaPositionBucket = mediaBucket
    updateMediaPosition()
  }
  const checkpointBucket = Math.floor(positionMilliseconds / POSITION_CHECKPOINT_MILLISECONDS)
  if (checkpointBucket !== lastCheckpointBucket) {
    lastCheckpointBucket = checkpointBucket
    checkpointSession()
  }
})

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => runTransport(playSelected),
    pause: () => player.pause(),
    previoustrack: () => runTransport(() => playAdjacent(previousTrack)),
    nexttrack: () => runTransport(() => playAdjacent(nextTrack)),
    seekbackward: ({ seekOffset = 10 } = {}) => seekTo(player.currentTime - seekOffset),
    seekforward: ({ seekOffset = 10 } = {}) => seekTo(player.currentTime + seekOffset),
    seekto: ({ seekTime } = {}) => seekTo(seekTime),
  }
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Older WebKit versions may expose Media Session without every handler.
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') checkpointSession()
})
window.addEventListener('pagehide', checkpointSession)
window.addEventListener('offline', () => {
  showPlaybackFeedback('You are offline. Playback can resume after reconnecting.', [
    { label: 'Retry', action: retrySelected },
  ])
})
window.addEventListener('online', () => {
  const actions = activeTrack ? [{ label: 'Retry', action: retrySelected }] : []
  showPlaybackFeedback(activeTrack ? 'Back online. Ready to retry.' : 'Back online.', actions)
})

restoreDeviceSession()
renderQueue()
load()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Jukebox service worker registration failed', error)
    })
  })
}

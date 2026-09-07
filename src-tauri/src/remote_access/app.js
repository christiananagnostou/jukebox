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
import { AUDIO_CACHE, createLibraryClient, saveOfflineTrack } from './data-cache.js'
import { createPlayerSheet, scrollBehavior } from './player-sheet.js'

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
const playerPanel = document.querySelector('#now-playing-panel')
const sheet = createPlayerSheet(playerPanel, document.querySelector('#sheet-handle'))
const libraryClient = createLibraryClient()
const offlineButton = document.querySelector('#save-offline')
let savingOffline = false
const scrollToTop = () => window.scrollTo({ top: 0, behavior: scrollBehavior() })
const seek = document.querySelector('#seek')
let scrubbing = false
const transportButtons = [...document.querySelectorAll('[data-transport]')]
const iconPaths = {
  refresh: 'M20 7V3l-3 3M4 17v4l3-3M20 7a8 8 0 0 0-14-2M4 17a8 8 0 0 0 14 2',
  play: 'M8 5l11 7-11 7z',
  pause: 'M8 5v14M16 5v14',
  next: 'M5 5l11 7-11 7zM19 5v14',
  previous: 'M19 5L8 12l11 7zM5 5v14',
  down: 'm6 9 6 6 6-6',
  back: 'm14 6-6 6 6 6',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3h3M20 16a3 3 0 1 1-3-3h3',
  album: 'M3 3h18v18H3zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  artist: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
  queue: 'M4 6h16M4 12h16M4 18h10',
}
const icon = (name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', iconPaths[name] || iconPaths.music)
  svg.append(path)
  return svg
}
for (const slot of document.querySelectorAll('[data-icon]')) slot.replaceChildren(icon(slot.dataset.icon))
const trackArtwork = (track) => (track ? `/api/tracks/${encodeURIComponent(track.id)}/artwork` : '')
const artwork = (url, className = '', eager = false) => {
  const holder = document.createElement('span')
  holder.className = `artwork ${className}`
  holder.append(icon(className === 'artist-art' ? 'artist' : 'music'))
  if (url) {
    const image = document.createElement('img')
    image.alt = ''
    image.loading = eager ? 'eager' : 'lazy'
    image.src = url
    image.addEventListener('error', () => image.remove(), { once: true })
    holder.append(image)
  }
  return holder
}
const formatTime = (seconds) => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
const updateControls = () => {
  for (const button of transportButtons) {
    const action = button.dataset.transport
    button.disabled = !activeTrack || (action === 'next' && playback.currentIndex >= playback.queue.length - 1)
    if (action === 'toggle') {
      const label = player.paused ? 'Play' : 'Pause'
      if (button.getAttribute('aria-label') !== label) {
        button.setAttribute('aria-label', label)
        button.replaceChildren(icon(player.paused ? 'play' : 'pause'))
      }
    }
  }
  seek.disabled = !activeTrack || !Number.isFinite(player.duration) || player.duration <= 0
  if (!scrubbing) seek.value = seek.disabled ? 0 : (player.currentTime / player.duration) * 100
  document.querySelector('#elapsed').textContent = formatTime(activeTrack ? player.currentTime : 0)
  document.querySelector('#duration').textContent = formatTime(activeTrack ? player.duration : 0)
  document.querySelector('#mini-progress').value = seek.disabled ? 0 : (player.currentTime / player.duration) * 100
}

let view = 'albums'
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
  if (actions.length && activeTrack) document.querySelector('#mini-detail').textContent = message
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
  items.dataset.layout = view
  document.querySelector('#view-title').textContent = album
    ? 'Songs'
    : view === 'tracks'
      ? 'Songs'
      : view === 'albums'
        ? 'Albums'
        : 'Artists'
}

const setMediaMetadata = (track) => {
  if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) return
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || track.file,
      artist: track.artist,
      album: track.album,
      artwork: [{ src: new URL(trackArtwork(track), window.location.origin).href }],
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
  void updateOfflineButton(track)
  document.querySelector('#mini-title').textContent = track ? track.title || track.file : 'Nothing playing'
  document.querySelector('#mini-detail').textContent = track
    ? track.artist || 'Unknown artist'
    : 'Choose a song to begin'
  document.querySelector('#now-artist').textContent = track?.artist || ''
  document.querySelector('#now-artist').disabled = !track?.artist
  nowPlayingDetail.disabled = !track?.album
  for (const id of ['#mini-art', '#now-art']) {
    document.querySelector(id).replaceChildren(...artwork(trackArtwork(track), '', true).childNodes)
  }
  for (const row of items.querySelectorAll('[data-track-id]'))
    row.classList.toggle('is-current', row.dataset.trackId === track?.id)
  updateControls()
  if (!track) {
    nowPlaying.textContent = 'Nothing playing'
    nowPlayingDetail.textContent = playback.queue.length ? 'Choose a queued track.' : 'Choose a track to begin.'
    return
  }
  nowPlaying.textContent = track.title || track.file
  nowPlayingDetail.textContent = track.album || 'Unknown album'
}

const updateOfflineButton = async (track) => {
  offlineButton.disabled = !track || savingOffline || !('caches' in window)
  if (!track || savingOffline) return
  try {
    const saved = await (await caches.open(AUDIO_CACHE)).match(`/api/tracks/${encodeURIComponent(track.id)}/stream`)
    if (activeTrack?.id !== track.id || savingOffline) return
    offlineButton.textContent = saved ? 'Remove offline copy' : 'Save offline'
  } catch {
    offlineButton.disabled = true
    offlineButton.textContent = 'Offline storage unavailable'
  }
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
  updateControls()
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

const playSelected = async () => {
  if (!activeTrack) return false
  try {
    await player.play()
    return true
  } catch {
    playbackError = true
    showPlaybackFeedback('Tap play to start audio.')
    return false
  } finally {
    updateControls()
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

const playPrevious = () => {
  if (player.currentTime > 3 || playback.currentIndex === 0) {
    seekTo(0)
    return playSelected()
  }
  return playAdjacent(previousTrack)
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
  showPlaybackFeedback('Ready to continue')
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

const itemButton = (primary, secondary, onClick, imageUrl = '', kind = '') => {
  const button = document.createElement('button')
  button.className = `item ${kind}`
  button.type = 'button'
  const title = document.createElement('strong')
  title.textContent = primary
  const description = document.createElement('span')
  description.textContent = secondary
  const copy = document.createElement('span')
  copy.className = 'item-copy'
  copy.append(title, description)
  button.append(artwork(imageUrl, kind === 'artist-item' ? 'artist-art' : ''), copy)
  button.addEventListener('click', onClick)
  return button
}

const renderTracks = (tracks, append) => {
  const start = append ? browseTracks.length : 0
  browseTracks = append
    ? [...browseTracks, ...tracks.slice(0, MAX_QUEUE_LENGTH - browseTracks.length)]
    : tracks.slice(0, MAX_QUEUE_LENGTH)
  browseTracks.slice(start).forEach((track, index) => {
    const row = itemButton(
      track.title || track.file,
      detail([track.artist, track.album], 'Unknown artist'),
      () => {
        playback = replaceQueue(playback, browseTracks)
        playbackRevision = revision
        runTransport(() => playAt(start + index))
      },
      trackArtwork(track)
    )
    row.dataset.trackId = track.id
    row.classList.toggle('is-current', activeTrack?.id === track.id)
    const duration = document.createElement('span')
    duration.className = 'item-duration'
    duration.textContent = track.duration
    row.append(duration)
    items.append(row)
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
        },
        '',
        'artist-item'
      )
    )
  }
}

const renderAlbums = (albums) => {
  for (const item of albums) {
    items.append(
      itemButton(
        item.name,
        detail([item.artist, item.date], 'Unknown artist'),
        () => {
          view = 'tracks'
          artist = item.artistValue
          album = item.value
          input.value = ''
          load()
        },
        `/api/artwork?${new URLSearchParams({ album: item.value, ...(item.artistValue ? { artist: item.artistValue } : {}) })}`,
        'album-item'
      )
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

const load = async ({ append = false, refresh = false } = {}) => {
  if (!append) {
    cursor = ''
    offset = 0
    total = 0
    revision = ''
    if (view === 'tracks') browseTracks = []
    items.replaceChildren()
    scrollToTop()
  }
  updateNavigation()
  const requestGeneration = ++generation
  setLibraryStatus(append ? 'Loading more…' : `Loading ${view}…`)
  loadMore.hidden = true
  try {
    const response = await libraryClient.get(requestUrl(), { refresh })
    if (requestGeneration !== generation) return
    if (response.status === 409 && append) {
      libraryClient.clear()
      return load({ refresh: true })
    }
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
      if (append && revision && revision !== String(body.revision)) {
        libraryClient.clear()
        return load({ refresh: true })
      }
      if (view === 'artists') renderArtists(body.items)
      else renderAlbums(body.items)
      offset += body.items.length
      total = body.total
      revision = String(body.revision)
      loadMore.hidden = offset >= total
      await validateRestoredSession(revision)
    }
    const offline = response.headers.get('x-jukebox-offline') === 'true'
    setLibraryStatus(
      (offline ? 'Offline · ' : '') +
        (offset
          ? view === 'tracks'
            ? `${offset}${cursor ? '+' : ''} tracks`
            : `${offset}${offset < total ? ` of ${total}` : ''} ${view}`
          : `No matching ${view}`)
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
    scrollToTop()
  })
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  load()
})
libraryRetry.addEventListener('click', () => load({ refresh: true }))
document.querySelector('#refresh-library').addEventListener('click', () => {
  libraryClient.clear()
  load({ refresh: true })
})
loadMore.addEventListener('click', () => load({ append: true }))
clearQueueButton.addEventListener('click', clearDeviceQueue)
document.querySelector('#open-player').addEventListener('click', () => void sheet.open())
document.querySelector('#close-player').addEventListener('click', () => void sheet.close())
document.querySelector('#show-queue').addEventListener('click', () => {
  const queue = document.querySelector('#queue-panel')
  queue.open = true
  queue.querySelector('summary').focus({ preventScroll: true })
  queue.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
})
for (const button of transportButtons) {
  button.addEventListener('click', () =>
    runTransport(() => {
      if (button.dataset.transport === 'next') return playAdjacent(nextTrack)
      if (button.dataset.transport === 'previous') return playPrevious()
      return player.paused ? playSelected() : player.pause()
    })
  )
}
seek.addEventListener('input', () => {
  scrubbing = true
  document.querySelector('#elapsed').textContent = formatTime((Number(seek.value) / 100) * player.duration)
})
const scrubAt = (event) => {
  const rect = seek.getBoundingClientRect()
  seek.value = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))
  scrubbing = true
  document.querySelector('#elapsed').textContent = formatTime((Number(seek.value) / 100) * player.duration)
}
seek.addEventListener('pointerdown', (event) => {
  if (seek.disabled || event.button !== 0) return
  event.preventDefault()
  seek.focus({ preventScroll: true })
  seek.setPointerCapture(event.pointerId)
  scrubAt(event)
})
seek.addEventListener('pointermove', (event) => {
  if (seek.hasPointerCapture(event.pointerId)) scrubAt(event)
})
seek.addEventListener('pointerup', (event) => {
  if (!seek.hasPointerCapture(event.pointerId)) return
  scrubAt(event)
  seek.releasePointerCapture(event.pointerId)
  seek.dispatchEvent(new Event('change'))
})
seek.addEventListener('change', () => {
  scrubbing = false
  seekTo((Number(seek.value) / 100) * player.duration)
  updateControls()
})
for (const event of ['blur', 'pointercancel']) {
  seek.addEventListener(event, () => {
    scrubbing = false
    updateControls()
  })
}
const browseCurrent = (target) => {
  if (!activeTrack) return
  void sheet.close()
  view = target === 'artist' ? 'albums' : 'tracks'
  artist = target === 'artist' ? activeTrack.artist : ''
  album = target === 'album' ? activeTrack.album : ''
  input.value = ''
  load()
  scrollToTop()
}
document.querySelector('#now-artist').addEventListener('click', () => browseCurrent('artist'))
nowPlayingDetail.addEventListener('click', () => browseCurrent('album'))
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
  showPlaybackFeedback('Playing')
  updateMediaPlaybackState()
  updateMediaPosition()
  updateControls()
  document.querySelector('#mini-detail').textContent = activeTrack?.artist || 'Unknown artist'
})
player.addEventListener('pause', () => {
  updateControls()
  updateMediaPlaybackState()
  checkpointSession()
  if (!playbackError && !player.ended && player.currentSrc) {
    showPlaybackFeedback('Paused')
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
player.addEventListener('durationchange', updateControls)
player.addEventListener('timeupdate', () => {
  updateControls()
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
    previoustrack: () => runTransport(playPrevious),
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
  libraryClient.clear()
  showPlaybackFeedback(
    'You are offline. Saved songs are available on this device.',
    activeTrack ? [{ label: 'Retry', action: retrySelected }] : []
  )
})
window.addEventListener('online', () => {
  libraryClient.clear()
  const actions = activeTrack ? [{ label: 'Retry', action: retrySelected }] : []
  showPlaybackFeedback(activeTrack ? 'Back online. Ready to retry.' : 'Back online.', actions)
})

offlineButton.addEventListener('click', () =>
  runTransport(async () => {
    if (!activeTrack || savingOffline) return
    const track = activeTrack
    const url = `/api/tracks/${encodeURIComponent(track.id)}/stream`
    savingOffline = true
    offlineButton.disabled = true
    offlineButton.textContent = 'Saving…'
    try {
      const cache = await caches.open(AUDIO_CACHE)
      if (await cache.match(url)) {
        await cache.delete(url)
        showPlaybackFeedback('Offline copy removed.')
      } else {
        await saveOfflineTrack(cache, url)
        showPlaybackFeedback('Saved on this device. Your five most recently saved songs stay available offline.')
      }
    } catch (error) {
      showPlaybackFeedback(
        error instanceof Error ? error.message : 'Could not save offline. Free some storage and try again.'
      )
    } finally {
      savingOffline = false
      await updateOfflineButton(activeTrack)
    }
  })
)

restoreDeviceSession()
updatePlayingCopy(activeTrack)
renderQueue()
load()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { type: 'module' }).catch((error) => {
      console.warn('Jukebox service worker registration failed', error)
    })
  })
}

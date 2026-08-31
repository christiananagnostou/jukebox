import {
  MAX_QUEUE_LENGTH,
  appendQueue,
  clampSeekTarget,
  createPlayerState,
  currentTrack as getCurrentTrack,
  endTrack,
  mediaSessionPositionState,
  nextTrack,
  previousTrack,
  replaceQueue,
  selectTrack,
} from './player-core.js'

const PAGE_SIZE = 50
const form = document.querySelector('#search-form')
const input = document.querySelector('#search')
const player = document.querySelector('#player')
const status = document.querySelector('#status')
const items = document.querySelector('#items')
const loadMore = document.querySelector('#load-more')
const back = document.querySelector('#back')
const context = document.querySelector('#context')
const contextLabel = document.querySelector('#context-label')
const nowPlaying = document.querySelector('#now-playing')
const viewButtons = [...document.querySelectorAll('[data-view]')]

let view = 'tracks'
let artist = ''
let album = ''
let cursor = ''
let offset = 0
let total = 0
let revision = ''
let generation = 0
let playback = createPlayerState()
let endedHandled = false
let playbackError = false
let activeTrack = null

const detail = (values, fallback) => values.filter(Boolean).join(' · ') || fallback

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

const selectedTrackLabel = () => {
  const track = activeTrack
  return track ? track.title || track.file : 'this track'
}

const playSelected = async () => {
  try {
    await player.play()
    return true
  } catch {
    playbackError = true
    status.textContent = 'Tap play to start audio.'
    return false
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

const seekTo = (target) => {
  const next = clampSeekTarget(target, player.duration)
  if (next === null) return false
  try {
    player.currentTime = next
    updateMediaPosition()
    return true
  } catch {
    return false
  }
}

const playAt = async (index, { fromEnded = false } = {}) => {
  const selected = selectTrack(playback, index)
  if (selected === playback && playback.currentIndex !== index) return false
  playback = selected
  const track = getCurrentTrack(playback)
  if (!track) return false
  activeTrack = track
  if (!fromEnded) endedHandled = false
  playbackError = false
  player.src = `/api/tracks/${encodeURIComponent(track.id)}/stream`
  nowPlaying.textContent = `${track.title || track.file} — ${track.artist || 'Unknown artist'}`
  setMediaMetadata(track)
  return playSelected()
}

const playAdjacent = async (transition, options) => {
  const next = transition(playback)
  if (next === playback || next.currentIndex === null) return false
  await playAt(next.currentIndex, options)
  return true
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
  const start = append ? playback.queue.length : 0
  playback = append ? appendQueue(playback, tracks) : replaceQueue(playback, tracks)
  const retained = playback.queue.slice(start)
  retained.forEach((track, index) => {
    items.append(
      itemButton(track.title || track.file, detail([track.artist, track.album, track.duration], 'Unknown artist'), () =>
        runTransport(() => playAt(start + index))
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
    items.replaceChildren()
  }
  updateNavigation()
  const requestGeneration = ++generation
  status.textContent = append ? 'Loading more…' : `Loading ${view}…`
  loadMore.hidden = true
  try {
    const response = await fetch(requestUrl())
    if (requestGeneration !== generation) return
    if (response.status === 409 && append) return load()
    if (!response.ok) throw new Error('Library request failed')
    const body = await response.json()
    if (requestGeneration !== generation) return
    if (view === 'tracks') {
      renderTracks(body, append)
      cursor = response.headers.get('x-jukebox-next-cursor') || ''
      revision = response.headers.get('x-jukebox-catalog-revision') || ''
      offset += body.length
      total = offset
      loadMore.hidden = !cursor || playback.queue.length >= MAX_QUEUE_LENGTH
    } else {
      if (append && revision && revision !== String(body.revision)) return load()
      if (view === 'artists') renderArtists(body.items)
      else renderAlbums(body.items)
      offset += body.items.length
      total = body.total
      revision = String(body.revision)
      loadMore.hidden = offset >= total
    }
    status.textContent = offset
      ? view === 'tracks'
        ? `${offset}${cursor ? '+' : ''} tracks`
        : `${offset}${offset < total ? ` of ${total}` : ''} ${view}`
      : `No matching ${view}`
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not load the library'
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
loadMore.addEventListener('click', () => load({ append: true }))
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
const runTransport = (operation) => {
  Promise.resolve()
    .then(operation)
    .catch(() => {
      status.textContent = 'This track could not be played. Tap play to retry.'
    })
}

player.addEventListener('error', () => {
  playbackError = true
  status.textContent = 'This track could not be played. Tap play to retry.'
})
player.addEventListener('stalled', () => {
  status.textContent = 'Audio stalled. Waiting to recover…'
})
player.addEventListener('waiting', () => {
  status.textContent = 'Buffering audio…'
})
player.addEventListener('playing', () => {
  endedHandled = false
  playbackError = false
  status.textContent = `Playing ${selectedTrackLabel()}.`
  updateMediaPosition()
})
player.addEventListener('pause', () => {
  if (!playbackError && !player.ended && player.currentSrc) status.textContent = 'Paused. Tap play to continue.'
})
player.addEventListener('ended', () => {
  if (endedHandled) return
  endedHandled = true
  runTransport(async () => {
    const advanced = await playAdjacent(endTrack, { fromEnded: true })
    if (!advanced) status.textContent = 'End of queue.'
  })
})
player.addEventListener('durationchange', updateMediaPosition)
player.addEventListener('timeupdate', updateMediaPosition)

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

load()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Jukebox service worker registration failed', error)
    })
  })
}

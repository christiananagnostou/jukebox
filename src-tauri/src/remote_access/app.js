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
let playQueue = []
let playingIndex = -1

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
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title || track.file,
    artist: track.artist,
    album: track.album,
  })
}

const playAt = async (index) => {
  const track = playQueue[index]
  if (!track) return
  playingIndex = index
  player.src = `/api/tracks/${encodeURIComponent(track.id)}/stream`
  nowPlaying.textContent = `${track.title || track.file} — ${track.artist || 'Unknown artist'}`
  setMediaMetadata(track)
  try {
    await player.play()
  } catch {
    status.textContent = 'Tap play to start audio.'
  }
}

const playAdjacent = (direction) => {
  const next = playingIndex + direction
  if (next >= 0 && next < playQueue.length) playAt(next)
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
  if (!append) playQueue = []
  const start = playQueue.length
  playQueue.push(...tracks)
  tracks.forEach((track, index) => {
    items.append(
      itemButton(track.title || track.file, detail([track.artist, track.album, track.duration], 'Unknown artist'), () =>
        playAt(start + index)
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
      loadMore.hidden = !cursor
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
player.addEventListener('ended', () => playAdjacent(1))

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => player.play(),
    pause: () => player.pause(),
    previoustrack: () => playAdjacent(-1),
    nexttrack: () => playAdjacent(1),
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

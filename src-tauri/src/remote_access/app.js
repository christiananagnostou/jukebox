const form = document.querySelector('#search-form')
const input = document.querySelector('#search')
const player = document.querySelector('#player')
const status = document.querySelector('#status')
const tracks = document.querySelector('#tracks')

const play = async (track) => {
  player.src = `/api/tracks/${encodeURIComponent(track.id)}/stream`
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
    })
  }
  try {
    await player.play()
  } catch {
    status.textContent = 'Tap play to start audio.'
  }
}

const load = async () => {
  status.textContent = 'Loading library…'
  tracks.replaceChildren()
  try {
    const response = await fetch(`/api/tracks?q=${encodeURIComponent(input.value)}&limit=100`)
    if (!response.ok) throw new Error('Library request failed')
    const items = await response.json()
    for (const track of items) {
      const button = document.createElement('button')
      button.className = 'track'
      const title = document.createElement('strong')
      title.textContent = track.title || track.file
      const detail = document.createElement('span')
      detail.textContent = [track.artist, track.album].filter(Boolean).join(' · ') || 'Unknown artist'
      button.append(title, detail)
      button.addEventListener('click', () => play(track))
      tracks.append(button)
    }
    status.textContent = items.length ? `${items.length} track${items.length === 1 ? '' : 's'}` : 'No matching tracks'
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not load the library'
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  load()
})
load()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Jukebox service worker registration failed', error)
    })
  })
}

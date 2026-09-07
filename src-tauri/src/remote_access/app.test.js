// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const tracks = [
  {
    id: 'one',
    title: 'First song',
    file: 'one.mp3',
    album: 'Together',
    artist: 'First artist',
    duration: '3:00',
    codec: 'mp3',
  },
  {
    id: 'two',
    title: 'Second song',
    file: 'two.mp3',
    album: 'Together',
    artist: 'Guest artist',
    duration: '4:00',
    codec: 'mp3',
  },
]
let audio
let paused
const click = (selector) => document.querySelector(selector).click()
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(async () => {
  vi.resetModules()
  const saved = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  })
  document.body.innerHTML = readFileSync('src-tauri/src/remote_access/index.html', 'utf8')
    .split('<body>')[1]
    .split('</body>')[0]
    .replace(/<script[^>]*><\/script>/g, '')
  audio = document.querySelector('audio')
  paused = true
  Object.defineProperties(audio, {
    paused: { configurable: true, get: () => paused },
    duration: { configurable: true, get: () => 180 },
  })
  audio.play = vi.fn(async () => {
    paused = false
    audio.dispatchEvent(new Event('playing'))
  })
  audio.pause = vi.fn(() => {
    paused = true
    audio.dispatchEvent(new Event('pause'))
  })
  audio.load = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const data = String(url).startsWith('/api/albums')
        ? {
            items: [
              {
                name: 'Together',
                value: 'Together',
                artist: 'Various Artists',
                artistValue: '',
                trackCount: 2,
                date: '2026',
              },
            ],
            total: 1,
            revision: 1,
          }
        : tracks
      return new Response(JSON.stringify(data), { headers: { 'x-jukebox-catalog-revision': '1' } })
    })
  )
  await import('./app.js')
  await settle()
})
afterEach(() => vi.unstubAllGlobals())

describe('private mobile player controls', () => {
  it('uses the heading for exceptional states and stays quiet during normal playback and pause', async () => {
    click('[data-view="tracks"]')
    await settle()
    click('[data-track-id="one"]')
    await settle()
    const feedback = document.querySelector('.playback-feedback')
    const heading = document.querySelector('#player-heading')
    expect(feedback.previousElementSibling.classList.contains('player-heading')).toBe(true)
    expect(heading.textContent).toBe('Now playing')
    expect(feedback.hidden).toBe(true)
    click('.transport [data-transport="toggle"]')
    await settle()
    expect(heading.textContent).toBe('Now playing')
    expect(feedback.hidden).toBe(true)
    expect(document.querySelector('#playback-actions').children).toHaveLength(0)
    expect(document.querySelector('.transport [aria-label="Play"]')).not.toBeNull()
    audio.dispatchEvent(new Event('waiting'))
    expect(heading.textContent).toBe('Buffering…')
    expect(feedback.hidden).toBe(true)
    audio.dispatchEvent(new Event('stalled'))
    expect(heading.textContent).toBe('Reconnecting…')
    expect(feedback.hidden).toBe(false)
    expect(document.querySelector('#playback-actions').textContent).toContain('Retry')
    click('.transport [data-transport="toggle"]')
    await settle()
    expect(heading.textContent).toBe('Now playing')
    expect(feedback.hidden).toBe(true)
    expect(document.querySelector('#playback-actions').children).toHaveLength(0)
  })

  it('uses the main play control after a browser rejects playback', async () => {
    audio.play.mockRejectedValueOnce(new Error('Gesture required'))
    click('[data-view="tracks"]')
    await settle()
    click('[data-track-id="one"]')
    await settle()
    expect(document.querySelector('#player-heading').textContent).toBe('Ready to play')
    expect(document.querySelector('#playback-message').textContent).toBe('Tap the play control to start audio.')
    expect(document.querySelector('#playback-actions').children).toHaveLength(0)
    click('.transport [data-transport="toggle"]')
    await settle()
    expect(paused).toBe(false)
  })

  it('keeps mini and full players synchronized through next, previous, pause and queue clearing', async () => {
    click('[data-view="tracks"]')
    await settle()
    click('[data-track-id="one"]')
    await settle()
    expect(document.querySelector('#mini-title').textContent).toBe('First song')
    expect(document.querySelector('#now-art img').getAttribute('src')).toBe('/api/tracks/one/artwork')
    expect(document.querySelector('[data-transport="toggle"]').getAttribute('aria-label')).toBe('Pause')
    click('#mini-player [data-transport="next"]')
    await settle()
    expect(document.querySelector('#now-playing').textContent).toBe('Second song')
    expect(document.querySelector('#mini-title').textContent).toBe('Second song')
    expect(document.querySelector('#now-artist').textContent).toBe('Guest artist')
    expect(document.querySelector('[data-transport="next"]').disabled).toBe(true)
    click('[data-transport="previous"]')
    await settle()
    expect(document.querySelector('#now-playing').textContent).toBe('First song')
    click('[data-transport="toggle"]')
    await settle()
    expect(paused).toBe(true)
    click('#clear-queue')
    expect(document.querySelector('#mini-title').textContent).toBe('Nothing playing')
    expect(document.querySelector('#now-art img')).toBeNull()
    expect(document.querySelector('[data-transport="toggle"]').disabled).toBe(true)
  })

  it('seeks and restarts the current song with previous after three seconds', async () => {
    click('[data-view="tracks"]')
    await settle()
    click('[data-track-id="two"]')
    await settle()
    const seek = document.querySelector('#seek')
    seek.value = '50'
    seek.dispatchEvent(new Event('change'))
    expect(audio.currentTime).toBe(90)
    seek.focus()
    audio.currentTime = 108
    audio.dispatchEvent(new Event('timeupdate'))
    expect(Number(seek.value)).toBe(60)
    click('[data-transport="previous"]')
    await settle()
    expect(audio.currentTime).toBe(0)
    expect(document.querySelector('#now-playing').textContent).toBe('Second song')
  })

  it('browses compilation albums without an empty artist filter and tolerates missing artwork', async () => {
    expect(document.querySelector('[data-view="albums"]').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('#items').dataset.layout).toBe('albums')
    const cover = document.querySelector('.album-item img')
    cover.dispatchEvent(new Event('error'))
    expect(document.querySelector('.album-item img')).toBeNull()
    expect(document.querySelector('.album-item svg')).not.toBeNull()
    click('.album-item')
    await settle()
    const url = fetch.mock.calls.at(-1)[0]
    expect(url).toContain('album=Together')
    expect(url).not.toContain('artist=')
    expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2)
  })
})

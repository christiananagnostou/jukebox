import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const origin = 'https://music.example.test'
let handlers, stores, network
const key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href
const store = (name) => {
  if (!stores.has(name)) {
    const entries = new Map()
    stores.set(name, {
      match: async (request) => entries.get(key(request))?.clone(),
      put: async (request, response) => entries.set(key(request), response.clone()),
      delete: async (request) => entries.delete(key(request)),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
    })
  }
  return stores.get(name)
}
const request = async (path, options) => {
  let response
  const background = []
  handlers.fetch({
    request: new Request(new URL(path, origin), options),
    respondWith: (value) => (response = value),
    waitUntil: (value) => background.push(value),
  })
  const result = await response
  await Promise.all(background)
  return result
}

beforeEach(async () => {
  vi.resetModules()
  handlers = {}
  stores = new Map()
  network = vi.fn()
  vi.stubGlobal('fetch', network)
  vi.stubGlobal('caches', { open: async (name) => store(name) })
  vi.stubGlobal('self', {
    location: { origin },
    addEventListener: (name, handler) => (handlers[name] = handler),
  })
  await import('./sw.js')
})
afterEach(() => vi.unstubAllGlobals())

describe('private player service worker', () => {
  it('caches visited catalog pages and marks fallback data as offline', async () => {
    network.mockResolvedValueOnce(Response.json({ items: ['Album'], revision: 2 }))
    expect((await request('/api/albums')).headers.has('x-jukebox-offline')).toBe(false)
    network.mockRejectedValueOnce(new TypeError('Disconnected'))
    const fallback = await request('/api/albums')
    expect(fallback.headers.get('x-jukebox-offline')).toBe('true')
    expect(await fallback.json()).toEqual({ items: ['Album'], revision: 2 })
    expect((await request('/api/artists')).status).toBe(503)
  })

  it('does not hide authorization failures behind cached private data', async () => {
    await store('jukebox-library-v1').put('/api/albums', Response.json({ items: ['Old album'] }))
    network.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
    expect((await request('/api/albums')).status).toBe(401)
    network.mockRejectedValueOnce(new TypeError('Disconnected'))
    expect((await request('/api/albums')).status).toBe(503)
  })

  it('serves byte ranges from explicitly saved audio without network access', async () => {
    await store('jukebox-audio-v1').put('/api/tracks/42/stream', new Response('abcdefghij'))
    const response = await request('/api/tracks/42/stream', { headers: { Range: 'bytes=2-5' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await response.text()).toBe('cdef')
    expect(network).not.toHaveBeenCalled()
  })

  it('does not automatically store streamed music', async () => {
    network.mockResolvedValueOnce(new Response('audio'))
    expect(await (await request('/api/tracks/42/stream')).text()).toBe('audio')
    expect(await store('jukebox-audio-v1').keys()).toHaveLength(0)
  })

  it('keeps online browsing available when cache storage is unavailable', async () => {
    vi.stubGlobal('caches', {
      open: async () => {
        throw new Error('Storage unavailable')
      },
    })
    network.mockResolvedValueOnce(Response.json({ items: ['Album'] }))
    expect(await (await request('/api/albums')).json()).toEqual({ items: ['Album'] })
  })

  it('leaves cross-origin and mutating requests alone', async () => {
    expect(await request('https://other.example.test/api/albums')).toBeUndefined()
    expect(await request('/api/albums', { method: 'POST' })).toBeUndefined()
    expect(network).not.toHaveBeenCalled()
  })
})

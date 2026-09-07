import { describe, expect, it, vi } from 'vitest'
import {
  createLibraryClient,
  cachedAudioResponse,
  saveOfflineTrack,
  trimCache,
  MAX_OFFLINE_TRACK_BYTES,
} from './data-cache.js'

const response = (revision = 1) =>
  new Response(JSON.stringify({ items: [], revision }), { headers: { 'content-type': 'application/json' } })
describe('library reads', () => {
  it('deduplicates concurrent reads and reuses pages until freshness expires', async () => {
    let now = 0
    const fetcher = vi.fn(async () => response())
    const client = createLibraryClient(fetcher, () => now)
    const [a, b] = await Promise.all([client.get('/api/albums'), client.get('/api/albums')])
    expect(await a.json()).toEqual(await b.json())
    await client.get('/api/albums')
    expect(fetcher).toHaveBeenCalledTimes(1)
    now = 46_000
    await client.get('/api/albums')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('invalidates other pages when catalog revision changes and supports explicit refresh', async () => {
    let revision = 1
    const fetcher = vi.fn(async () => response(revision))
    const client = createLibraryClient(fetcher)
    await client.get('/api/albums')
    revision = 2
    await client.get('/api/artists')
    expect((await (await client.get('/api/albums')).json()).revision).toBe(2)
    await client.get('/api/albums', { refresh: true })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('does not cache failures or hold failed requests in flight', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response())
    const client = createLibraryClient(fetcher)
    await expect(client.get('/api/albums')).rejects.toThrow('offline')
    expect((await client.get('/api/albums')).ok).toBe(true)
  })
})

describe('offline audio', () => {
  it.each([
    ['bytes=2-5', '2345'],
    ['bytes=7-', '789'],
    ['bytes=-3', '789'],
  ])('serves %s for Safari seeking', async (range, content) => {
    const result = await cachedAudioResponse(new Response('0123456789'), range)
    expect(result.status).toBe(206)
    expect(await result.text()).toBe(content)
    expect(result.headers.get('accept-ranges')).toBe('bytes')
  })
  it.each(['bytes=10-', 'bytes=-0', 'bytes=2-1', 'bytes=0-1,3-4', 'bytes=-'])(
    'rejects invalid range %s',
    async (range) => {
      const result = await cachedAudioResponse(new Response('0123456789'), range)
      expect(result.status).toBe(416)
    }
  )
  it('never stores partial or oversized downloads', async () => {
    const cache = { put: vi.fn(), keys: vi.fn(async () => []) }
    await expect(saveOfflineTrack(cache, '/song', async () => new Response('part', { status: 206 }))).rejects.toThrow()
    await expect(
      saveOfflineTrack(
        cache,
        '/song',
        async () => new Response('x', { headers: { 'content-length': String(MAX_OFFLINE_TRACK_BYTES + 1) } })
      )
    ).rejects.toThrow('too large')
    expect(cache.put).not.toHaveBeenCalled()
  })
  it('stores complete audio and trims oldest entries to the bounded limit', async () => {
    const cache = { put: vi.fn(), keys: vi.fn(async () => ['a', 'b', 'c', 'd', 'e', 'f']), delete: vi.fn() }
    await saveOfflineTrack(cache, '/song', async () => new Response('whole song'))
    expect(await cache.put.mock.calls[0][1].text()).toBe('whole song')
    expect(cache.delete).toHaveBeenCalledWith('a')
    await trimCache(cache, 4)
    expect(cache.delete).toHaveBeenCalledWith('b')
  })
})

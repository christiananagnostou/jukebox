import { describe, expect, it, vi } from 'vitest'
import { LibraryController } from './library'
import { initialLibrary } from './model'

const page = (name: string, revision = 1) =>
  Response.json({
    items: [{ name, value: name, artist: 'Various Artists', artistValue: '', date: '', trackCount: 2 }],
    total: 1,
    revision,
  })
describe('mobile HTTP library controller', () => {
  it('defaults to albums and preserves exact compilation queries', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(page('Compilation'))
      .mockResolvedValueOnce(Response.json([]))
    const s = initialLibrary()
    const controller = new LibraryController(s, fetcher)
    await controller.load()
    expect(s.albums[0].name).toBe('Compilation')
    await controller.navigate('tracks', s.albums[0].artistValue, s.albums[0].value)
    expect(String(fetcher.mock.calls[1][0])).toContain('album=Compilation')
    expect(String(fetcher.mock.calls[1][0])).not.toContain('artist=')
  })
  it('ignores late failures and successes after another navigation', async () => {
    let fail!: (error: Error) => void
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject
          })
      )
      .mockResolvedValueOnce(Response.json({ items: [], total: 0, revision: 1 }))
    const s = initialLibrary()
    const controller = new LibraryController(s, fetcher)
    const first = controller.load()
    await controller.navigate('artists')
    fail(new Error('Old error'))
    await first
    expect(s.view).toBe('artists')
    expect(s.error).toBe('')
    expect(s.loading).toBe(false)
  })
  it('restarts a stale cursor without mixing catalog revisions', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(Response.json([], { headers: { 'x-jukebox-catalog-revision': '2' } }))
    const s = initialLibrary()
    Object.assign(s, { view: 'tracks', cursor: 'old', revision: '1' })
    await new LibraryController(s, fetcher).load(true)
    expect(s.revision).toBe('2')
    expect(String(fetcher.mock.calls[1][0])).not.toContain('cursor=')
  })
  it('marks offline results and coalesces fresh repeated navigation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ items: [], total: 0, revision: 1 }, { headers: { 'x-jukebox-offline': 'true' } })
      )
    const s = initialLibrary()
    const controller = new LibraryController(s, fetcher)
    await controller.load()
    await controller.load()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(s.offline).toBe(true)
    await controller.load(false, true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

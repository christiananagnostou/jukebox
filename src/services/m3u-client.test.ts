import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import {
  applyM3uImport,
  discardM3uImport,
  listM3uImportIssues,
  MAX_RETAINED_M3U_ISSUE_PAGES,
  m3uIssueAt,
  type M3uImportIssue,
  M3uImportLease,
  type M3uIssueCatalogState,
  M3uIssuePager,
  pickM3uExport,
  pickM3uImport,
} from './m3u-client'

function catalogState(): M3uIssueCatalogState {
  return { error: '', pages: {}, status: 'loading', total: 0 }
}

function issue(line: number): M3uImportIssue {
  return { kind: 'missing', line, name: `track-${line}.flac` }
}

describe('native M3U client', () => {
  beforeEach(() => invokeMock.mockReset())

  it('keeps selected filesystem paths behind native picker commands', async () => {
    invokeMock.mockResolvedValue(null)
    const playlistId = 'playlist_0123456789abcdef0123456789abcdef'

    await pickM3uImport()
    await pickM3uExport(playlistId)

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'pick_m3u_import')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'pick_m3u_export', { playlistId })
  })

  it('addresses reviewed plans by bounded opaque token and camelCase payloads', async () => {
    invokeMock.mockResolvedValue({ items: [], total: 0 })
    const token = '0123456789abcdef0123456789abcdef'
    const query = { limit: 50, offset: 100 }

    await listM3uImportIssues(token, query)
    await applyM3uImport(token, 'Imported playlist')
    await discardM3uImport(token)

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_m3u_import_issues', { query, token })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'apply_m3u_import', {
      name: 'Imported playlist',
      token,
    })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'discard_m3u_import', { token })
  })

  it('releases abandoned tokens exactly once, retries failures, and preserves consumed plans', async () => {
    const discard = vi.fn().mockResolvedValue(true)
    const lease = new M3uImportLease('token-one', discard)
    await Promise.all([lease.release(), lease.release()])
    expect(discard).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledWith('token-one')

    const consumedDiscard = vi.fn().mockResolvedValue(true)
    const consumed = new M3uImportLease('token-two', consumedDiscard)
    consumed.consume()
    expect(await consumed.release()).toBe(false)
    expect(consumedDiscard).not.toHaveBeenCalled()

    const retryDiscard = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(true)
    const retry = new M3uImportLease('token-three', retryDiscard)
    await expect(retry.release()).rejects.toThrow('temporary')
    await expect(retry.release()).resolves.toBe(true)
    expect(retryDiscard).toHaveBeenCalledTimes(2)
  })

  it('loads 100-row issue pages and retains only the five nearest pages', async () => {
    const state = catalogState()
    const fetchPage = vi.fn(async (_token: string, query: { limit: number; offset: number }) => ({
      items: Array.from({ length: query.limit }, (_, index) => issue(query.offset + index + 1)),
      total: 10_000,
    }))
    const pager = new M3uIssuePager(state, fetchPage)

    await pager.reset('token-one')
    await pager.ensureRange(0, 799)

    expect(fetchPage).toHaveBeenLastCalledWith('token-one', { limit: 100, offset: 700 })
    expect(Object.keys(state.pages)).toHaveLength(MAX_RETAINED_M3U_ISSUE_PAGES)
    expect(m3uIssueAt(state, 300)?.line).toBe(301)
  })

  it('drops in-flight work from a superseded import token', async () => {
    const state = catalogState()
    let finishFirst: ((value: { items: M3uImportIssue[]; total: number }) => void) | undefined
    const firstPage = new Promise<{ items: M3uImportIssue[]; total: number }>((resolve) => {
      finishFirst = resolve
    })
    const fetchPage = vi.fn((token: string) => {
      if (token === 'token-one') return firstPage
      return Promise.resolve({ items: [issue(2)], total: 1 })
    })
    const pager = new M3uIssuePager(state, fetchPage)

    const first = pager.reset('token-one')
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledWith('token-one', { limit: 100, offset: 0 }))
    const second = pager.reset('token-two')
    finishFirst?.({ items: [issue(1)], total: 1 })
    await Promise.all([first, second])

    expect(fetchPage).toHaveBeenLastCalledWith('token-two', { limit: 100, offset: 0 })
    expect(state.pages['0']?.[0]?.line).toBe(2)
  })

  it('reloads the visible issue page and reports path-free failures', async () => {
    const state = catalogState()
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [issue(1)], total: 1_000 })
      .mockResolvedValueOnce({ items: [issue(701)], total: 1_000 })
      .mockResolvedValueOnce({ items: [issue(702)], total: 1_000 })
      .mockRejectedValueOnce({ message: 'That playlist import review expired.' })
    const pager = new M3uIssuePager(state, fetchPage)

    await pager.reset('token')
    await pager.ensureRange(700, 700)
    await pager.reload()
    expect(fetchPage).toHaveBeenLastCalledWith('token', { limit: 100, offset: 700 })
    expect(state.pages['7']?.[0]?.line).toBe(702)
    await pager.reload()
    expect(state.status).toBe('error')
    expect(state.error).toBe('That playlist import review expired.')
  })
})

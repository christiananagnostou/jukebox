import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { applyM3uImport, discardM3uImport, listM3uImportIssues, pickM3uExport, pickM3uImport } from './m3u-client'

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
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { clearPlayHistory, listPlayHistory } from './history-client'

describe('native listening-history client', () => {
  beforeEach(() => invokeMock.mockReset())

  it('uses bounded camelCase page payloads and a separate explicit clear command', async () => {
    invokeMock.mockResolvedValue({ affected: 0, items: [], total: 0 })
    const query = { limit: 50, offset: 100 }

    await listPlayHistory(query)
    await clearPlayHistory()

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_play_history', { query })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'clear_play_history')
  })
})

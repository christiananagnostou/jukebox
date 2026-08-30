import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { queryBuiltInCollection } from './library-client'

describe('built-in collection client', () => {
  beforeEach(() => invoke.mockReset())

  it('sends one bounded typed native query', async () => {
    invoke.mockResolvedValue({ items: [], revision: '8:13:5', total: 0 })

    await expect(queryBuiltInCollection({ kind: 'most_played', limit: 100, offset: 200 })).resolves.toEqual({
      items: [],
      revision: '8:13:5',
      total: 0,
    })
    expect(invoke).toHaveBeenCalledWith('query_built_in_collection', {
      query: { kind: 'most_played', limit: 100, offset: 200 },
    })
  })
})

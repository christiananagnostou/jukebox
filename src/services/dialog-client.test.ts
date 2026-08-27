import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { pickMusicFolders } from './dialog-client'

describe('pickMusicFolders', () => {
  beforeEach(() => invokeMock.mockReset())

  it('uses the bounded native picker instead of the scope-expanding dialog guest', async () => {
    invokeMock.mockResolvedValue(['/music/one', '/music/two'])

    await expect(pickMusicFolders({ defaultPath: '/music', multiple: true })).resolves.toEqual([
      '/music/one',
      '/music/two',
    ])
    expect(invokeMock).toHaveBeenCalledWith('pick_import_directories', {
      defaultPath: '/music',
      multiple: true,
    })
  })
})

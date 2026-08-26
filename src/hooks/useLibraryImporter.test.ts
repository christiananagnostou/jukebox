import { describe, expect, it } from 'vitest'

import { partitionImportPaths } from './useLibraryImporter'

describe('partitionImportPaths', () => {
  it('keeps directories out of the legacy single-file importer', async () => {
    const paths = ['/library', '/music/track.flac', '/ignored']
    const kinds = new Map([
      ['/library', { isDirectory: true, isFile: false }],
      ['/music/track.flac', { isDirectory: false, isFile: true }],
      ['/ignored', { isDirectory: false, isFile: false }],
    ])

    await expect(
      partitionImportPaths(paths, async (path) => kinds.get(path) || { isDirectory: false, isFile: false })
    ).resolves.toEqual({ directories: ['/library'], files: ['/music/track.flac'] })
  })
})

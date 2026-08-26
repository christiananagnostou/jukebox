import { describe, expect, it } from 'vitest'

import {
  addLibraryRoot,
  applyLibraryRefreshEvent,
  cancelLibraryRefresh,
  isLibraryRefreshActive,
  libraryRefreshProgress,
  listLibraryRefreshes,
  listLibraryRoots,
  setLibraryRootEnabled,
  startLibraryRefresh,
  watcherStatusLabel,
  type LibraryCommandInvoker,
  type LibraryRefresh,
} from './library-refresh'
import type { Store } from '~/App'

const refresh = (status: string, withPreparation = false): LibraryRefresh => ({
  scan: {
    discovered: 12,
    failed: 0,
    id: 9,
    rootId: 3,
    startedAt: 'now',
    status: status === 'running' ? 'running' : 'completed',
    unavailable: 0,
    updated: 0,
  },
  reconciliation: withPreparation
    ? {
        changed: 2,
        failed: 0,
        processed: 7,
        renamed: 0,
        rootId: 3,
        scanId: 9,
        startedAt: 'now',
        status: 'preparing',
        total: 10,
        unavailable: 0,
        unchanged: 5,
      }
    : undefined,
  status,
})

describe('native library commands', () => {
  it('uses stable Tauri command names and camel-case payloads', async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = []
    const run: LibraryCommandInvoker = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push([command, args])
      return {} as T
    }

    await listLibraryRoots(run)
    await addLibraryRoot('/music', run)
    await setLibraryRootEnabled(3, false, run)
    await listLibraryRefreshes(run)
    await startLibraryRefresh(3, run)
    await cancelLibraryRefresh(9, run)

    expect(calls).toEqual([
      ['list_library_roots', undefined],
      ['add_library_root', { path: '/music' }],
      ['set_library_root_enabled', { id: 3, enabled: false }],
      ['list_library_refreshes', undefined],
      ['start_library_refresh', { rootId: 3 }],
      ['cancel_library_refresh', { scanId: 9 }],
    ])
  })
})

describe('library refresh presentation', () => {
  it('distinguishes active and terminal states', () => {
    expect(isLibraryRefreshActive(refresh('running'))).toBe(true)
    expect(isLibraryRefreshActive(refresh('preparing', true))).toBe(true)
    expect(isLibraryRefreshActive(refresh('completed'))).toBe(false)
    expect(isLibraryRefreshActive(refresh('failed'))).toBe(false)
  })

  it('invalidates catalog state once for a completed refresh', () => {
    const store = {
      legacyCatalog: [{ id: 'old' }],
      legacyCatalogLoaded: true,
      libraryCatalog: { refreshKey: 4 },
      sync: { lastRunAt: '', message: '', processed: 0, status: 'scanning', total: 1 },
    } as unknown as Store
    const terminalScanIds = new Set<number>()
    const completed = refresh('completed')

    expect(applyLibraryRefreshEvent(store, completed, terminalScanIds)).toBe(true)
    expect(store.legacyCatalog).toEqual([])
    expect(store.legacyCatalogLoaded).toBe(false)
    expect(store.libraryCatalog.refreshKey).toBe(5)
    expect(store.sync.status).toBe('idle')

    expect(applyLibraryRefreshEvent(store, completed, terminalScanIds)).toBe(false)
    expect(store.libraryCatalog.refreshKey).toBe(5)
  })

  it('reports active progress without invalidating the catalog', () => {
    const store = {
      legacyCatalog: [],
      legacyCatalogLoaded: false,
      libraryCatalog: { refreshKey: 2 },
      sync: { lastRunAt: '', message: '', processed: 0, status: 'idle', total: 0 },
    } as unknown as Store

    expect(applyLibraryRefreshEvent(store, refresh('preparing', true), new Set())).toBe(false)
    expect(store.sync).toMatchObject({ message: 'Reading metadata', processed: 7, status: 'scanning', total: 10 })
    expect(store.libraryCatalog.refreshKey).toBe(2)
  })

  it('uses preparation progress when it exists', () => {
    expect(libraryRefreshProgress(refresh('running'))).toEqual({ processed: 12, total: 0 })
    expect(libraryRefreshProgress(refresh('preparing', true))).toEqual({ processed: 7, total: 10 })
  })

  it('maps watcher states to concise labels', () => {
    expect(watcherStatusLabel('watching')).toBe('Watching for changes')
    expect(watcherStatusLabel('degraded')).toBe('Recovering')
    expect(watcherStatusLabel('unavailable')).toBe('Folder unavailable')
  })
})

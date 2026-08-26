import { invoke } from '@tauri-apps/api/core'
import { useVisibleTask$ } from '@builder.io/qwik'
import { listen } from '@tauri-apps/api/event'

import type { Store } from '~/App'

export const LIBRARY_REFRESH_EVENT = 'library-refresh-progress'

export interface LibraryRoot {
  createdAt: string
  enabled: boolean
  id: number
  lastScanAt?: string
  path: string
  watchStatus: 'inactive' | 'starting' | 'watching' | 'degraded' | 'unavailable'
}

export interface LibraryScan {
  completedAt?: string
  discovered: number
  errorSummary?: string
  failed: number
  id: number
  rootId: number
  startedAt: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  unavailable: number
  updated: number
}

export interface LibraryReconciliation {
  changed: number
  completedAt?: string
  errorSummary?: string
  failed: number
  processed: number
  renamed: number
  rootId: number
  scanId: number
  startedAt: string
  status: 'pending' | 'preparing' | 'ready' | 'applying' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  total: number
  unavailable: number
  unchanged: number
}

export interface LibraryRefresh {
  reconciliation?: LibraryReconciliation
  scan: LibraryScan
  status: string
}

export type LibraryCommandInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

const invokeCommand: LibraryCommandInvoker = (command, args) => invoke(command, args)

export const listLibraryRoots = (run: LibraryCommandInvoker = invokeCommand) => run<LibraryRoot[]>('list_library_roots')

export const addLibraryRoot = (path: string, run: LibraryCommandInvoker = invokeCommand) =>
  run<LibraryRoot>('add_library_root', { path })

export const setLibraryRootEnabled = (id: number, enabled: boolean, run: LibraryCommandInvoker = invokeCommand) =>
  run<LibraryRoot>('set_library_root_enabled', { id, enabled })

export const listLibraryRefreshes = (run: LibraryCommandInvoker = invokeCommand) =>
  run<LibraryRefresh[]>('list_library_refreshes')

export const startLibraryRefresh = (rootId: number, run: LibraryCommandInvoker = invokeCommand) =>
  run<LibraryRefresh>('start_library_refresh', { rootId })

export const cancelLibraryRefresh = (scanId: number, run: LibraryCommandInvoker = invokeCommand) =>
  run<LibraryRefresh>('cancel_library_refresh', { scanId })

export function isLibraryRefreshActive(refresh?: LibraryRefresh): boolean {
  return Boolean(refresh && !['cancelled', 'completed', 'failed', 'interrupted'].includes(refresh.status))
}

export function libraryRefreshProgress(refresh: LibraryRefresh): { processed: number; total: number } {
  if (refresh.reconciliation) {
    return { processed: refresh.reconciliation.processed, total: refresh.reconciliation.total }
  }
  return { processed: refresh.scan.discovered, total: 0 }
}

export function watcherStatusLabel(status: LibraryRoot['watchStatus']): string {
  const labels: Record<LibraryRoot['watchStatus'], string> = {
    degraded: 'Recovering',
    inactive: 'Not watching',
    starting: 'Starting',
    unavailable: 'Folder unavailable',
    watching: 'Watching for changes',
  }
  return labels[status]
}

function refreshMessage(status: string): string {
  const messages: Record<string, string> = {
    applying: 'Updating library',
    pending: 'Waiting to scan',
    preparing: 'Reading metadata',
    ready: 'Preparing catalog update',
    running: 'Scanning music folders',
  }
  return messages[status] || 'Refreshing library'
}

export function applyLibraryRefreshEvent(store: Store, refresh: LibraryRefresh, terminalScanIds: Set<number>): boolean {
  if (isLibraryRefreshActive(refresh)) {
    const progress = libraryRefreshProgress(refresh)
    store.sync.status = 'scanning'
    store.sync.processed = progress.processed
    store.sync.total = progress.total
    store.sync.message = refreshMessage(refresh.status)
    return false
  }

  const isNewTerminalEvent = !terminalScanIds.has(refresh.scan.id)
  terminalScanIds.add(refresh.scan.id)
  store.sync.lastRunAt = refresh.scan.completedAt || new Date().toISOString()
  if (refresh.status === 'failed' || refresh.status === 'interrupted') {
    store.sync.status = 'error'
    store.sync.message = refresh.reconciliation?.errorSummary || refresh.scan.errorSummary || 'Library refresh failed'
    return false
  }

  store.sync.status = 'idle'
  store.sync.message = refresh.status === 'cancelled' ? 'Library refresh cancelled' : ''
  if (refresh.status !== 'completed' || !isNewTerminalEvent) return false

  store.libraryCatalog.refreshKey += 1
  return true
}

export function useLibraryRefreshEvents(store: Store): void {
  useVisibleTask$(({ cleanup }) => {
    const latestByRoot = new Map<number, LibraryRefresh>()
    const terminalScanIds = new Set<number>()
    let disposed = false
    let unlisten: (() => void) | undefined

    const hydrate = () =>
      listLibraryRefreshes()
        .then((refreshes) => {
          if (disposed) return
          for (const refresh of refreshes) {
            const current = latestByRoot.get(refresh.scan.rootId)
            if (
              current &&
              (current.scan.id > refresh.scan.id ||
                (current.scan.id === refresh.scan.id &&
                  !isLibraryRefreshActive(current) &&
                  isLibraryRefreshActive(refresh)))
            ) {
              continue
            }
            latestByRoot.set(refresh.scan.rootId, refresh)
            if (isLibraryRefreshActive(refresh) && !terminalScanIds.has(refresh.scan.id)) {
              applyLibraryRefreshEvent(store, refresh, terminalScanIds)
            } else terminalScanIds.add(refresh.scan.id)
          }
        })
        .catch(() => undefined)

    void listen<LibraryRefresh>(LIBRARY_REFRESH_EVENT, ({ payload }) => {
      if (disposed) return
      latestByRoot.set(payload.scan.rootId, payload)
      applyLibraryRefreshEvent(store, payload, terminalScanIds)
      if (!isLibraryRefreshActive(payload)) {
        const remaining = [...latestByRoot.values()].find(isLibraryRefreshActive)
        if (remaining) applyLibraryRefreshEvent(store, remaining, terminalScanIds)
      }
    })
      .then((stop) => {
        if (disposed) {
          stop()
          return
        }
        unlisten = stop
        void hydrate()
      })
      .catch(() => void hydrate())

    cleanup(() => {
      disposed = true
      unlisten?.()
    })
  })
}

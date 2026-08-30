import { invoke } from '@tauri-apps/api/core'

import { playlistErrorMessage, type PlaylistSummary } from '~/services/playlist-client'

export type M3uImportIssueKind = 'ambiguous' | 'missing' | 'unavailable' | 'unmatched'

export interface M3uImportIssue {
  kind: M3uImportIssueKind
  line: number
  name: string
}

export interface M3uImportPreview {
  ambiguousEntries: number
  duplicateEntries: number
  matchedEntries: number
  missingEntries: number
  suggestedName: string
  token: string
  totalEntries: number
  unavailableEntries: number
  unmatchedEntries: number
}

export interface M3uIssueQuery {
  limit: number
  offset: number
}

export interface M3uIssuePage {
  items: M3uImportIssue[]
  total: number
}

export interface M3uIssueCatalogState {
  error: string
  pages: Record<string, M3uImportIssue[]>
  status: 'loading' | 'ready' | 'error'
  total: number
}

export const M3U_ISSUE_PAGE_SIZE = 100
export const MAX_RETAINED_M3U_ISSUE_PAGES = 5

export type M3uIssuePageFetcher = (token: string, query: M3uIssueQuery) => Promise<M3uIssuePage>
export type M3uImportDiscarder = (token: string) => Promise<boolean>

export interface M3uImportResult {
  playlist: PlaylistSummary
  skippedEntries: number
}

export interface M3uExportResult {
  exportedEntries: number
  skippedUnavailableEntries: number
}

export function pickM3uImport(): Promise<M3uImportPreview | null> {
  return invoke('pick_m3u_import')
}

export function listM3uImportIssues(token: string, query: M3uIssueQuery): Promise<M3uIssuePage> {
  return invoke('list_m3u_import_issues', { query, token })
}

export function applyM3uImport(token: string, name: string): Promise<M3uImportResult> {
  return invoke('apply_m3u_import', { name, token })
}

export function discardM3uImport(token: string): Promise<boolean> {
  return invoke('discard_m3u_import', { token })
}

export function pickM3uExport(playlistId: string): Promise<M3uExportResult | null> {
  return invoke('pick_m3u_export', { playlistId })
}

export class M3uImportLease {
  private consumed = false
  private releasePromise?: Promise<boolean>

  constructor(
    private readonly token: string,
    private readonly discard: M3uImportDiscarder = discardM3uImport
  ) {}

  consume(): void {
    this.consumed = true
  }

  release(): Promise<boolean> {
    if (this.consumed) return Promise.resolve(false)
    if (!this.releasePromise) {
      this.releasePromise = this.discard(this.token)
        .then((released) => {
          this.consumed = true
          return released
        })
        .catch((error: unknown) => {
          this.releasePromise = undefined
          throw error
        })
    }
    return this.releasePromise
  }
}

export class M3uIssuePager {
  private generation = 0
  private lastEndPage = 0
  private lastStartPage = 0
  private queue = Promise.resolve()
  private token = ''

  constructor(
    private readonly state: M3uIssueCatalogState,
    private readonly fetchPage: M3uIssuePageFetcher = listM3uImportIssues
  ) {}

  reset(token: string): Promise<void> {
    if (token === this.token && this.state.status !== 'error') return this.queue
    this.token = token
    this.lastStartPage = 0
    this.lastEndPage = 0
    return this.enqueueRange(0, 0, this.beginQuery())
  }

  reload(): Promise<void> {
    if (!this.token) return Promise.resolve()
    return this.enqueueRange(this.lastStartPage, this.lastEndPage, this.beginQuery())
  }

  clear(): void {
    this.token = ''
    this.lastStartPage = 0
    this.lastEndPage = 0
    this.beginQuery()
  }

  ensureRange(startIndex: number, endIndex: number): Promise<void> {
    if (this.state.status === 'error' || endIndex < 0) return Promise.resolve()
    const startPage = Math.max(0, Math.floor(startIndex / M3U_ISSUE_PAGE_SIZE))
    const endPage = Math.max(startPage, Math.floor(endIndex / M3U_ISSUE_PAGE_SIZE))
    this.lastStartPage = startPage
    this.lastEndPage = endPage
    return this.enqueueRange(startPage, endPage, this.generation)
  }

  dispose(): void {
    this.generation += 1
  }

  private enqueueRange(startPage: number, endPage: number, generation: number): Promise<void> {
    this.queue = this.queue.then(() => this.loadRange(startPage, endPage, generation))
    return this.queue
  }

  private async loadRange(startPage: number, endPage: number, generation: number): Promise<void> {
    try {
      for (let pageIndex = startPage; pageIndex <= endPage; pageIndex += 1) {
        if (generation !== this.generation || !this.token) return
        if (this.state.pages[String(pageIndex)]) continue
        const page = await this.fetchPage(this.token, {
          limit: M3U_ISSUE_PAGE_SIZE,
          offset: pageIndex * M3U_ISSUE_PAGE_SIZE,
        })
        if (generation !== this.generation) return
        this.state.pages[String(pageIndex)] = page.items
        this.state.total = page.total
      }
      if (generation !== this.generation) return
      this.evictDistantPages(startPage, endPage)
      this.state.error = ''
      this.state.status = 'ready'
    } catch (error) {
      if (generation !== this.generation) return
      this.state.error = playlistErrorMessage(error, 'Jukebox could not load the playlist import review.')
      this.state.status = 'error'
    }
  }

  private beginQuery(): number {
    this.generation += 1
    this.state.error = ''
    this.state.pages = {}
    this.state.status = 'loading'
    this.state.total = 0
    return this.generation
  }

  private evictDistantPages(startPage: number, endPage: number): void {
    const center = (startPage + endPage) / 2
    const retained = Object.keys(this.state.pages)
      .map(Number)
      .sort((left, right) => Math.abs(left - center) - Math.abs(right - center))
      .slice(0, MAX_RETAINED_M3U_ISSUE_PAGES)
    const keep = new Set(retained.map(String))
    for (const pageIndex of Object.keys(this.state.pages)) {
      if (!keep.has(pageIndex)) delete this.state.pages[pageIndex]
    }
  }
}

export function m3uIssueAt(state: M3uIssueCatalogState, index: number): M3uImportIssue | undefined {
  const pageIndex = Math.floor(index / M3U_ISSUE_PAGE_SIZE)
  return state.pages[String(pageIndex)]?.[index % M3U_ISSUE_PAGE_SIZE]
}

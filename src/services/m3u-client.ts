import { invoke } from '@tauri-apps/api/core'

import type { PlaylistSummary } from '~/services/playlist-client'

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

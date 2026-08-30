import type { M3uImportIssueKind, M3uImportPreview } from '~/services/m3u-client'

export interface M3uPreviewStat {
  label: string
  tone: 'default' | 'warning'
  value: number
}

export function validM3uPlaylistName(value: string): boolean {
  const normalized = value.trim()
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  return Boolean(normalized && [...normalized].length <= 200 && !hasControlCharacter)
}

export function canApplyM3uImport(preview: M3uImportPreview, name: string): boolean {
  return preview.matchedEntries > 0 && validM3uPlaylistName(name)
}

export function skippedM3uEntries(preview: M3uImportPreview): number {
  return Math.max(0, preview.totalEntries - preview.matchedEntries)
}

export function m3uReviewIssueCount(preview: M3uImportPreview): number {
  return preview.unavailableEntries + preview.missingEntries + preview.ambiguousEntries + preview.unmatchedEntries
}

export function m3uPreviewStats(preview: M3uImportPreview): M3uPreviewStat[] {
  return [
    { label: 'Total', tone: 'default', value: preview.totalEntries },
    { label: 'Ready', tone: 'default', value: preview.matchedEntries },
    { label: 'Duplicates', tone: 'default', value: preview.duplicateEntries },
    { label: 'Offline', tone: preview.unavailableEntries ? 'warning' : 'default', value: preview.unavailableEntries },
    { label: 'Missing', tone: preview.missingEntries ? 'warning' : 'default', value: preview.missingEntries },
    { label: 'Ambiguous', tone: preview.ambiguousEntries ? 'warning' : 'default', value: preview.ambiguousEntries },
    { label: 'Unmatched', tone: preview.unmatchedEntries ? 'warning' : 'default', value: preview.unmatchedEntries },
  ]
}

export function m3uIssueLabel(kind: M3uImportIssueKind): string {
  const labels: Record<M3uImportIssueKind, string> = {
    ambiguous: 'Ambiguous',
    missing: 'Missing',
    unavailable: 'Offline',
    unmatched: 'Not in library',
  }
  return labels[kind]
}

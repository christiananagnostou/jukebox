import { describe, expect, it } from 'vitest'

import type { M3uImportPreview } from './m3u-client'
import {
  canApplyM3uImport,
  m3uIssueLabel,
  m3uPreviewStats,
  m3uReviewIssueCount,
  skippedM3uEntries,
  validM3uPlaylistName,
} from './m3u-workflow'

const preview: M3uImportPreview = {
  ambiguousEntries: 1,
  duplicateEntries: 2,
  matchedEntries: 7,
  missingEntries: 1,
  suggestedName: 'Road trip',
  token: '0123456789abcdef0123456789abcdef',
  totalEntries: 11,
  unavailableEntries: 1,
  unmatchedEntries: 1,
}

describe('M3U import workflow model', () => {
  it('allows apply only with matched tracks and a bounded printable name', () => {
    expect(canApplyM3uImport(preview, ' Road trip ')).toBe(true)
    expect(canApplyM3uImport({ ...preview, matchedEntries: 0 }, 'Road trip')).toBe(false)
    expect(canApplyM3uImport(preview, '')).toBe(false)
    expect(validM3uPlaylistName('x'.repeat(200))).toBe(true)
    expect(validM3uPlaylistName('x'.repeat(201))).toBe(false)
    expect(validM3uPlaylistName('bad\nname')).toBe(false)
  })

  it('summarizes every preview count and skipped entry without underflow', () => {
    expect(m3uPreviewStats(preview)).toEqual([
      { label: 'Total', tone: 'default', value: 11 },
      { label: 'Ready', tone: 'default', value: 7 },
      { label: 'Duplicates', tone: 'default', value: 2 },
      { label: 'Offline', tone: 'warning', value: 1 },
      { label: 'Missing', tone: 'warning', value: 1 },
      { label: 'Ambiguous', tone: 'warning', value: 1 },
      { label: 'Unmatched', tone: 'warning', value: 1 },
    ])
    expect(skippedM3uEntries(preview)).toBe(4)
    expect(skippedM3uEntries({ ...preview, matchedEntries: 12 })).toBe(0)
    expect(m3uReviewIssueCount(preview)).toBe(4)
  })

  it('uses compact user-facing labels for every redacted issue kind', () => {
    expect(m3uIssueLabel('ambiguous')).toBe('Ambiguous')
    expect(m3uIssueLabel('missing')).toBe('Missing')
    expect(m3uIssueLabel('unavailable')).toBe('Offline')
    expect(m3uIssueLabel('unmatched')).toBe('Not in library')
  })
})

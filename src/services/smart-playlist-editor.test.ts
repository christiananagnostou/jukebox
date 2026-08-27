import { describe, expect, it } from 'vitest'

import type { SmartPlaylistDefinition } from './smart-playlist-client'
import {
  defaultSmartPlaylistDraft,
  defaultSmartRuleDraft,
  smartPlaylistDefinitionFromDraft,
  smartPlaylistDraftFromDefinition,
  smartRuleNeedsValue,
  smartRuleOperators,
  smartRuleWithField,
  type SmartPlaylistDraft,
} from './smart-playlist-editor'

const completeDefinition: SmartPlaylistDefinition = {
  version: 1,
  matchMode: 'any',
  rules: [
    { field: 'text', value: 'night drive' },
    { field: 'artist', operator: 'contains', value: 'Björk' },
    { field: 'album', operator: 'is_not', value: 'Live' },
    { field: 'genre', operator: 'starts_with', value: 'Ambient' },
    { field: 'codec', operator: 'ends_with', value: 'ac' },
    { field: 'year', operator: 'greater_than_or_equal', value: 1990 },
    { field: 'favorite', operator: 'equal', value: 2 },
    { field: 'date_added', operator: 'on_or_after', value: '2025-01-31' },
    { field: 'last_played', operator: 'is_not_set', value: null },
    { field: 'play_count', operator: 'less_than', value: 5 },
    { field: 'duration_ms', operator: 'greater_than', value: 1234 },
    { field: 'sample_rate', operator: 'equal', value: 96_000 },
    { field: 'availability', operator: 'is', value: 'available' },
    { field: 'root', operator: 'is_not', value: 0 },
  ],
  resultLimit: 2_500,
  sort: 'last_played',
  direction: 'desc',
}

function draftWith(rule: SmartPlaylistDraft['rules'][number]): SmartPlaylistDraft {
  return { ...defaultSmartPlaylistDraft(), rules: [rule] }
}

describe('smart playlist editor model', () => {
  it('starts with a bounded available-track rule and field-specific defaults', () => {
    expect(smartPlaylistDefinitionFromDraft(defaultSmartPlaylistDraft())).toEqual({
      version: 1,
      matchMode: 'all',
      rules: [{ field: 'availability', operator: 'is', value: 'available' }],
      resultLimit: 500,
      sort: 'default',
      direction: 'asc',
    })
    expect(smartRuleWithField('artist')).toEqual({ field: 'artist', operator: 'contains', value: '' })
    expect(smartRuleWithField('sample_rate')).toEqual({
      field: 'sample_rate',
      operator: 'greater_than_or_equal',
      value: '44100',
    })
    expect(smartRuleOperators('text')).toEqual([])
    expect(smartRuleOperators('date_added').map(({ value }) => value)).toContain('is_not_set')
  })

  it('round trips every native version-one rule family without loss', () => {
    const draft = smartPlaylistDraftFromDefinition(completeDefinition)
    expect(draft.rules.find((rule) => rule.field === 'duration_ms')?.value).toBe('1.234')
    expect(smartPlaylistDefinitionFromDraft(draft)).toEqual(completeDefinition)
  })

  it('normalizes text and converts user-facing seconds to milliseconds', () => {
    expect(
      smartPlaylistDefinitionFromDraft(
        draftWith({ field: 'artist', operator: 'does_not_contain', value: '  Various Artists  ' })
      ).rules[0]
    ).toEqual({ field: 'artist', operator: 'does_not_contain', value: 'Various Artists' })
    expect(
      smartPlaylistDefinitionFromDraft(
        draftWith({ field: 'duration_ms', operator: 'greater_than_or_equal', value: '245.125' })
      ).rules[0]
    ).toEqual({ field: 'duration_ms', operator: 'greater_than_or_equal', value: 245_125 })
  })

  it('pairs date presence operators with no value and validates calendar dates', () => {
    const presence = { field: 'last_played', operator: 'is_set', value: 'ignored' } as const
    expect(smartRuleNeedsValue(presence)).toBe(false)
    expect(smartPlaylistDefinitionFromDraft(draftWith(presence)).rules[0]).toEqual({
      field: 'last_played',
      operator: 'is_set',
      value: null,
    })
    expect(() =>
      smartPlaylistDefinitionFromDraft(
        draftWith({ field: 'date_added', operator: 'on_or_before', value: '2025-02-29' })
      )
    ).toThrow('valid calendar date')
  })

  it.each([
    [{ ...defaultSmartPlaylistDraft(), rules: [] }, 'between 1 and 32 rules'],
    [{ ...defaultSmartPlaylistDraft(), resultLimit: '0' }, 'Result limit'],
    [draftWith({ field: 'text', operator: '', value: '---' }), 'searchable letter or number'],
    [draftWith({ field: 'year', operator: 'equal', value: '10000' }), 'Rule 1'],
    [draftWith({ field: 'favorite', operator: 'equal', value: '3' }), 'Rule 1'],
    [draftWith({ field: 'play_count', operator: 'equal', value: '' }), 'Rule 1'],
    [draftWith({ field: 'duration_ms', operator: 'equal', value: '1.0001' }), 'millisecond precision'],
    [draftWith({ field: 'sample_rate', operator: 'unknown', value: '44100' }), 'unsupported operator'],
    [draftWith({ field: 'availability', operator: 'is', value: 'missing' }), 'invalid availability'],
    [draftWith({ field: 'root', operator: 'is', value: '-1' }), 'Rule 1'],
  ])('rejects invalid drafts before native invocation', (draft, message) => {
    expect(() => smartPlaylistDefinitionFromDraft(draft as SmartPlaylistDraft)).toThrow(message as string)
  })

  it('creates safe defaults for every field', () => {
    for (const field of completeDefinition.rules.map((rule) => rule.field)) {
      expect(defaultSmartRuleDraft(field).field).toBe(field)
    }
  })
})

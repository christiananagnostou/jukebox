import type {
  SmartDateOperator,
  SmartEqualityOperator,
  SmartNumberOperator,
  SmartPlaylistDefinition,
  SmartRule,
  SmartTextOperator,
} from '~/services/smart-playlist-client'

export type SmartRuleField = SmartRule['field']

export interface SmartRuleDraft {
  field: SmartRuleField
  operator: string
  value: string
}

export interface SmartPlaylistDraft {
  direction: SmartPlaylistDefinition['direction']
  matchMode: SmartPlaylistDefinition['matchMode']
  resultLimit: string
  rules: SmartRuleDraft[]
  sort: SmartPlaylistDefinition['sort']
}

export interface SmartOption<Value extends string = string> {
  label: string
  value: Value
}

export const SMART_RULE_FIELDS: SmartOption<SmartRuleField>[] = [
  { label: 'Search', value: 'text' },
  { label: 'Artist', value: 'artist' },
  { label: 'Album', value: 'album' },
  { label: 'Genre', value: 'genre' },
  { label: 'Codec', value: 'codec' },
  { label: 'Year', value: 'year' },
  { label: 'Favorite rating', value: 'favorite' },
  { label: 'Date added', value: 'date_added' },
  { label: 'Last played', value: 'last_played' },
  { label: 'Play count', value: 'play_count' },
  { label: 'Duration', value: 'duration_ms' },
  { label: 'Sample rate', value: 'sample_rate' },
  { label: 'Availability', value: 'availability' },
  { label: 'Library root', value: 'root' },
]

export const SMART_SORT_OPTIONS: SmartOption<SmartPlaylistDefinition['sort']>[] = [
  { label: 'Default', value: 'default' },
  { label: 'Title', value: 'title' },
  { label: 'Artist', value: 'artist' },
  { label: 'Album', value: 'album' },
  { label: 'Year', value: 'year' },
  { label: 'Date added', value: 'date_added' },
  { label: 'Favorite rating', value: 'favorite' },
  { label: 'Last played', value: 'last_played' },
  { label: 'Play count', value: 'play_count' },
  { label: 'Duration', value: 'duration' },
  { label: 'Sample rate', value: 'sample_rate' },
]

const TEXT_OPERATORS: SmartOption<SmartTextOperator>[] = [
  { label: 'is', value: 'is' },
  { label: 'is not', value: 'is_not' },
  { label: 'contains', value: 'contains' },
  { label: 'does not contain', value: 'does_not_contain' },
  { label: 'starts with', value: 'starts_with' },
  { label: 'ends with', value: 'ends_with' },
]

const NUMBER_OPERATORS: SmartOption<SmartNumberOperator>[] = [
  { label: 'equals', value: 'equal' },
  { label: 'does not equal', value: 'not_equal' },
  { label: 'is greater than', value: 'greater_than' },
  { label: 'is at least', value: 'greater_than_or_equal' },
  { label: 'is less than', value: 'less_than' },
  { label: 'is at most', value: 'less_than_or_equal' },
]

const DATE_OPERATORS: SmartOption<SmartDateOperator>[] = [
  { label: 'is before', value: 'before' },
  { label: 'is on or before', value: 'on_or_before' },
  { label: 'is after', value: 'after' },
  { label: 'is on or after', value: 'on_or_after' },
  { label: 'is set', value: 'is_set' },
  { label: 'is not set', value: 'is_not_set' },
]

const EQUALITY_OPERATORS: SmartOption<SmartEqualityOperator>[] = [
  { label: 'is', value: 'is' },
  { label: 'is not', value: 'is_not' },
]

const TEXT_FIELDS = new Set<SmartRuleField>(['artist', 'album', 'genre', 'codec'])
const NUMBER_FIELDS = new Set<SmartRuleField>(['year', 'favorite', 'play_count', 'duration_ms', 'sample_rate'])
const DATE_FIELDS = new Set<SmartRuleField>(['date_added', 'last_played'])
const EQUALITY_FIELDS = new Set<SmartRuleField>(['availability', 'root'])

const NUMBER_BOUNDS: Partial<Record<SmartRuleField, readonly [number, number]>> = {
  favorite: [0, 2],
  play_count: [0, 1_000_000],
  sample_rate: [1, 1_000_000],
  year: [1, 9_999],
}

export function defaultSmartRuleDraft(field: SmartRuleField = 'availability'): SmartRuleDraft {
  if (field === 'text') return { field, operator: '', value: '' }
  if (TEXT_FIELDS.has(field)) return { field, operator: 'contains', value: '' }
  if (NUMBER_FIELDS.has(field)) {
    const value = field === 'favorite' ? '1' : field === 'sample_rate' ? '44100' : field === 'year' ? '2000' : '0'
    return { field, operator: 'greater_than_or_equal', value }
  }
  if (DATE_FIELDS.has(field)) return { field, operator: 'on_or_after', value: '' }
  if (field === 'availability') return { field, operator: 'is', value: 'available' }
  return { field, operator: 'is', value: '0' }
}

export function defaultSmartPlaylistDraft(): SmartPlaylistDraft {
  return {
    direction: 'asc',
    matchMode: 'all',
    resultLimit: '500',
    rules: [defaultSmartRuleDraft()],
    sort: 'default',
  }
}

export function smartRuleOperators(field: SmartRuleField): SmartOption[] {
  if (TEXT_FIELDS.has(field)) return TEXT_OPERATORS
  if (NUMBER_FIELDS.has(field)) return NUMBER_OPERATORS
  if (DATE_FIELDS.has(field)) return DATE_OPERATORS
  if (EQUALITY_FIELDS.has(field)) return EQUALITY_OPERATORS
  return []
}

export function smartRuleNeedsValue(rule: SmartRuleDraft): boolean {
  return !DATE_FIELDS.has(rule.field) || !['is_set', 'is_not_set'].includes(rule.operator)
}

export function smartRuleWithField(field: SmartRuleField): SmartRuleDraft {
  return defaultSmartRuleDraft(field)
}

function assertText(value: string, label: string): string {
  const normalized = value.trim()
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (!normalized || [...normalized].length > 1_024 || hasControlCharacter) {
    throw new Error(`${label} must contain between 1 and 1,024 printable characters.`)
  }
  return normalized
}

function assertOperator<Value extends string>(operator: string, options: SmartOption<Value>[], label: string): Value {
  if (!options.some((option) => option.value === operator)) throw new Error(`${label} uses an unsupported operator.`)
  return operator as Value
}

function parseInteger(value: string, minimum: number, maximum: number, label: string): number {
  if (!value.trim()) {
    throw new Error(
      `${label} must be a whole number between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}.`
    )
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${label} must be a whole number between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}.`
    )
  }
  return parsed
}

function parseDurationMs(value: string): number {
  if (!value.trim()) {
    throw new Error('Duration must be between 0 and 604,800 seconds with at most millisecond precision.')
  }
  const seconds = Number(value)
  const milliseconds = Math.round(seconds * 1_000)
  if (
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds > 604_800 ||
    !Number.isSafeInteger(milliseconds) ||
    Math.abs(milliseconds / 1_000 - seconds) > Number.EPSILON * Math.max(1, seconds)
  ) {
    throw new Error('Duration must be between 0 and 604,800 seconds with at most millisecond precision.')
  }
  return milliseconds
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= days
}

function definitionRule(draft: SmartRuleDraft, index: number): SmartRule {
  const label = `Rule ${index + 1}`
  if (draft.field === 'text') {
    const value = assertText(draft.value, label)
    if (!/[\p{L}\p{N}]/u.test(value)) throw new Error(`${label} must include a searchable letter or number.`)
    return { field: 'text', value }
  }
  if (TEXT_FIELDS.has(draft.field)) {
    const operator = assertOperator(draft.operator, TEXT_OPERATORS, label)
    const value = assertText(draft.value, label)
    return { field: draft.field as 'artist' | 'album' | 'genre' | 'codec', operator, value }
  }
  if (NUMBER_FIELDS.has(draft.field)) {
    const operator = assertOperator(draft.operator, NUMBER_OPERATORS, label)
    if (draft.field === 'duration_ms') return { field: 'duration_ms', operator, value: parseDurationMs(draft.value) }
    const [minimum, maximum] = NUMBER_BOUNDS[draft.field] ?? [0, Number.MAX_SAFE_INTEGER]
    const value = parseInteger(draft.value, minimum, maximum, label)
    return { field: draft.field as 'year' | 'favorite' | 'play_count' | 'sample_rate', operator, value }
  }
  if (DATE_FIELDS.has(draft.field)) {
    const operator = assertOperator(draft.operator, DATE_OPERATORS, label)
    const field = draft.field as 'date_added' | 'last_played'
    if (operator === 'is_set' || operator === 'is_not_set') return { field, operator, value: null }
    if (!isIsoDate(draft.value)) throw new Error(`${label} must use a valid calendar date.`)
    return { field, operator, value: draft.value }
  }
  if (draft.field === 'availability') {
    const operator = assertOperator(draft.operator, EQUALITY_OPERATORS, label)
    if (!['available', 'unavailable'].includes(draft.value)) throw new Error(`${label} has an invalid availability.`)
    return { field: 'availability', operator, value: draft.value as 'available' | 'unavailable' }
  }
  const operator = assertOperator(draft.operator, EQUALITY_OPERATORS, label)
  return { field: 'root', operator, value: parseInteger(draft.value, 0, Number.MAX_SAFE_INTEGER, label) }
}

export function smartPlaylistDefinitionFromDraft(draft: SmartPlaylistDraft): SmartPlaylistDefinition {
  if (!['all', 'any'].includes(draft.matchMode)) throw new Error('Choose whether all or any rules should match.')
  if (draft.rules.length < 1 || draft.rules.length > 32)
    throw new Error('Smart playlists require between 1 and 32 rules.')
  if (!SMART_SORT_OPTIONS.some((option) => option.value === draft.sort))
    throw new Error('Choose a supported sort order.')
  if (!['asc', 'desc'].includes(draft.direction)) throw new Error('Choose a supported sort direction.')
  return {
    version: 1,
    matchMode: draft.matchMode,
    rules: draft.rules.map(definitionRule),
    resultLimit: parseInteger(draft.resultLimit, 1, 10_000, 'Result limit'),
    sort: draft.sort,
    direction: draft.direction,
  }
}

function draftRule(rule: SmartRule): SmartRuleDraft {
  if (rule.field === 'text') return { field: rule.field, operator: '', value: rule.value }
  if (rule.field === 'duration_ms') {
    return { field: rule.field, operator: rule.operator, value: String(rule.value / 1_000) }
  }
  if (rule.field === 'date_added' || rule.field === 'last_played') {
    return { field: rule.field, operator: rule.operator, value: rule.value ?? '' }
  }
  return { field: rule.field, operator: rule.operator, value: String(rule.value) }
}

export function smartPlaylistDraftFromDefinition(definition: SmartPlaylistDefinition): SmartPlaylistDraft {
  return {
    direction: definition.direction,
    matchMode: definition.matchMode,
    resultLimit: String(definition.resultLimit),
    rules: definition.rules.map(draftRule),
    sort: definition.sort,
  }
}

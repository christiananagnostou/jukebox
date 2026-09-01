import { describe, expect, it } from 'vitest'

import { shouldFocusLibrarySearch, type SearchShortcutEvent } from './search-shortcut'

const slash = (overrides: Partial<SearchShortcutEvent> = {}): SearchShortcutEvent => ({
  altKey: false,
  ctrlKey: false,
  key: '/',
  metaKey: false,
  ...overrides,
})

describe('library search shortcut', () => {
  it('focuses search for an unmodified slash outside an editor', () => {
    expect(shouldFocusLibrarySearch(slash(), false)).toBe(true)
  })

  it('does not steal slash while typing or using a modified shortcut', () => {
    expect(shouldFocusLibrarySearch(slash(), true)).toBe(false)
    expect(shouldFocusLibrarySearch(slash({ metaKey: true }), false)).toBe(false)
    expect(shouldFocusLibrarySearch(slash({ ctrlKey: true }), false)).toBe(false)
    expect(shouldFocusLibrarySearch(slash({ altKey: true }), false)).toBe(false)
    expect(shouldFocusLibrarySearch(slash({ key: 's' }), false)).toBe(false)
  })
})

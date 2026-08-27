import { describe, expect, it } from 'vitest'

import { getErrorMessage } from './Errors'

describe('getErrorMessage', () => {
  it('reads native and structured command errors', () => {
    expect(getErrorMessage(new Error('native failure'))).toBe('native failure')
    expect(getErrorMessage({ code: 'history_unavailable', message: 'Listening history is unavailable' })).toBe(
      'Listening history is unavailable'
    )
  })

  it('falls back without serializing arbitrary objects', () => {
    expect(getErrorMessage('plain failure')).toBe('plain failure')
    expect(getErrorMessage({ privatePath: '/private/music' })).toBe('[object Object]')
  })
})

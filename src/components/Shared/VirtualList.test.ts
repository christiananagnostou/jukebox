import { describe, expect, it } from 'vitest'

import { computeVirtualRange, scrollTopForVirtualRow } from './VirtualList'

describe('computeVirtualRange', () => {
  it('requests only the visible window and overscan', () => {
    expect(computeVirtualRange(300, 300, 30, 10_000, 10)).toEqual({
      startIndex: 0,
      endIndex: 30,
    })
    expect(computeVirtualRange(3_000, 300, 30, 10_000, 10)).toEqual({
      startIndex: 90,
      endIndex: 120,
    })
  })

  it('clamps the range at the end of the catalog', () => {
    expect(computeVirtualRange(2_850, 300, 30, 100, 10)).toEqual({
      startIndex: 85,
      endIndex: 99,
    })
  })
})

describe('scrollTopForVirtualRow', () => {
  it('scrolls every newly selected row into view at an exact viewport boundary', () => {
    expect(scrollTopForVirtualRow(0, 90, 30, 2, 100)).toBeUndefined()
    expect(scrollTopForVirtualRow(0, 90, 30, 3, 100)).toBe(30)
    expect(scrollTopForVirtualRow(30, 90, 30, 4, 100)).toBe(60)
  })

  it('scrolls upward and rejects invalid geometry', () => {
    expect(scrollTopForVirtualRow(300, 90, 30, 8, 100)).toBe(240)
    expect(scrollTopForVirtualRow(0, 0, 30, 1, 100)).toBeUndefined()
    expect(scrollTopForVirtualRow(0, 90, 30, 100, 100)).toBeUndefined()
  })
})

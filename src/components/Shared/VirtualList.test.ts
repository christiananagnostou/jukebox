import { describe, expect, it, vi } from 'vitest'

vi.mock('@builder.io/qwik', () => ({
  $: (callback: unknown) => callback,
  Slot: () => null,
  component$: (component: unknown) => component,
  useSignal: (value: unknown) => ({ value }),
  useTask$: () => undefined,
  useVisibleTask$: () => undefined,
}))

import { computeVirtualRange } from './VirtualList'

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

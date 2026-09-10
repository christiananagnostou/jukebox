import { $, component$, useContextProvider, useStore } from '@builder.io/qwik'
import { createDOM } from '@builder.io/qwik/testing'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Song, Store, StoreActions } from '~/App'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import Library from './index'

vi.mock('@builder.io/qwik-city', () => ({ Link: (props: { children?: unknown }) => props.children ?? null }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path, invoke: vi.fn() }))

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => vi.unstubAllGlobals())

async function createLibraryDOM() {
  const dom = await createDOM()
  // The DOM test renderer has no layout engine; give virtual scrolling a viewport.
  Object.defineProperty(Object.getPrototypeOf(dom.screen.ownerDocument.createElement('div')), 'clientHeight', {
    configurable: true,
    get: () => 600,
  })
  return dom
}

const Harness = component$(() => {
  const tracks = Array.from(
    { length: 100 },
    (_, index) =>
      ({
        id: String(index),
        title: `Song ${index}`,
        artist: 'Artist',
        album: 'Album',
        duration: '0:03:24.000',
        favorRating: 0,
        dateAdded: '2026-01-01',
        trackNumber: index + 1,
        sampleRate: '44100',
        date: '2026',
      }) as Song
  )
  const store = useStore({
    libraryCatalog: { pages: { '0': tracks }, total: 100_000, status: 'ready' },
    libraryView: { cursorIdx: 0 },
    playback: { current: null },
    sorting: 'default',
  } as unknown as Store)
  useContextProvider(StoreContext, store)
  useContextProvider(StoreActionsContext, { requestLibraryRange: $(() => {}) } as unknown as StoreActions)
  return <Library />
})

describe('Songs list', () => {
  it('renders only a small virtual window for a 100,000-song library', async () => {
    const { render, screen } = await createLibraryDOM()
    await render(<Harness />)
    const rows = screen.querySelectorAll('.songs-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(60)
    expect(screen.querySelector('[role="table"]')?.getAttribute('aria-rowcount')).toBe('100001')
    expect(screen.querySelector('[data-column="duration"]')?.textContent).toBe('03:24')
    expect(screen.querySelector('[data-column="hertz"]')).toBeFalsy()
    expect(screen.querySelector('[data-selected="true"]')).toBeTruthy()
  })

  it('toggles matching header and row columns, then restores defaults', async () => {
    const { render, screen, userEvent } = await createLibraryDOM()
    await render(<Harness />)
    // Qwik's test renderer flushes one scheduling layer at a time.
    await userEvent(screen, 'renderFlush')
    const labels = Array.from(screen.querySelectorAll('.songs-column-options label'))
    const sampleRate = labels.find((label) => label.textContent?.includes('Sample rate'))!.querySelector('input')!
    sampleRate.checked = true
    await userEvent(sampleRate, 'change')
    expect(localStorage.setItem).toHaveBeenCalled()
    expect(JSON.parse(vi.mocked(localStorage.setItem).mock.calls.at(-1)![1]).hertz.visible).toBe(true)
    for (let frame = 0; frame < 3; frame++) await userEvent(screen, 'renderFlush')
    expect(screen.querySelector('[data-column-resize="hertz"]')).toBeTruthy()
    expect(screen.querySelector('[data-column="hertz"]')?.textContent).toBe('44100')
    await userEvent(screen.querySelector('.songs-column-options button')!, 'click')
    for (let frame = 0; frame < 3; frame++) await userEvent(screen, 'renderFlush')
    expect(screen.querySelector('[data-column="hertz"]')).toBeFalsy()
    expect(screen.querySelector('[data-column-resize="hertz"]')).toBeFalsy()
    expect(screen.querySelector<HTMLInputElement>('.songs-column-options input')?.disabled).toBe(true)
  })

  it('sorts in both directions using the existing catalog state', async () => {
    const { render, screen, userEvent } = await createLibraryDOM()
    await render(<Harness />)
    const header = screen.querySelector('.songs-column-heading')!
    await userEvent(header.querySelector('button')!, 'click')
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    await userEvent(header.querySelector('button')!, 'click')
    expect(header.getAttribute('aria-sort')).toBe('descending')
  })
})

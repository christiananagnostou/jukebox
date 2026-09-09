// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindColumnResize } from './column-resize'

let root: HTMLElement, handle: HTMLElement, dispose: () => void
const commit = vi.fn()
function pointer(type: string, clientX: number, pointerId = 1) {
  handle.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX, pointerId, button: 0 }))
}
beforeEach(() => {
  commit.mockClear()
  root = document.createElement('section')
  root.style.setProperty('--song-title-width', '260px')
  handle = document.createElement('span')
  handle.dataset.columnResize = 'title'
  handle.tabIndex = 0
  handle.setPointerCapture = vi.fn()
  handle.hasPointerCapture = vi.fn(() => true)
  handle.releasePointerCapture = vi.fn()
  root.append(handle)
  document.body.append(root)
  dispose = bindColumnResize(root, commit)
})
afterEach(() => {
  dispose()
  root.remove()
})

describe('column resizing', () => {
  it('previews every pointer move without committing state or storage until release', () => {
    pointer('pointerdown', 100)
    for (let offset = 1; offset <= 100; offset++) pointer('pointermove', 100 + offset)
    expect(root.style.getPropertyValue('--song-title-width')).toBe('360px')
    expect(handle.getAttribute('aria-valuenow')).toBe('360')
    expect(commit).not.toHaveBeenCalled()
    pointer('pointerup', 200)
    expect(commit).toHaveBeenCalledExactlyOnceWith('title', 360)
    expect(root.dataset.resizing).toBeUndefined()
  })
  it('clamps widths, ignores other pointers and cancels cleanly', () => {
    pointer('pointerdown', 100)
    pointer('pointermove', 500, 2)
    expect(root.style.getPropertyValue('--song-title-width')).toBe('260px')
    pointer('pointermove', -500)
    expect(root.style.getPropertyValue('--song-title-width')).toBe('140px')
    pointer('pointercancel', -500)
    expect(root.style.getPropertyValue('--song-title-width')).toBe('260px')
    expect(commit).not.toHaveBeenCalled()
  })
  it('supports keyboard adjustments and reset without trapping Tab', () => {
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    handle.dispatchEvent(right)
    expect(right.defaultPrevented).toBe(true)
    expect(commit).toHaveBeenLastCalledWith('title', 270)
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }))
    expect(commit).toHaveBeenLastCalledWith('title', 230)
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(commit).toHaveBeenLastCalledWith('title', 260)
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    handle.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
  })
  it('resets on double click and removes all listeners on disposal', () => {
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(commit).toHaveBeenCalledExactlyOnceWith('title', 260)
    dispose()
    pointer('pointerdown', 0)
    pointer('pointermove', 100)
    pointer('pointerup', 100)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayerSheet, scrollBehavior } from './player-sheet.js'

let panel, handle, surface, overlay, sheet, transitions
const finish = async () => {
  transitions.forEach((item) => item.resolve())
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
const pointer = (type, x, y, time, id = 1) => {
  const event = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, isPrimary: true })
  Object.defineProperty(event, 'timeStamp', { value: time })
  handle.dispatchEvent(event)
}
beforeEach(() => {
  document.body.innerHTML =
    '<button id="opener">Open</button><dialog style="--sheet-enter-ms:420;--sheet-exit-ms:300;--sheet-reduced-ms:120"><div data-sheet-overlay></div><div data-sheet-surface><div class="player-screen"><div id="handle"></div><h2 id="player-heading" tabindex="-1">Now playing</h2></div></div></dialog>'
  panel = document.querySelector('dialog')
  surface = panel.querySelector('[data-sheet-surface]')
  overlay = panel.querySelector('[data-sheet-overlay]')
  handle = panel.querySelector('#handle')
  transitions = []
  const animate = vi.fn((frames, options) => {
    let resolve
    const finished = new Promise((done) => {
      resolve = done
    })
    const animation = { finished, cancel: vi.fn(() => resolve()) }
    transitions.push({ resolve, animation, frames, options })
    return animation
  })
  surface.animate = animate
  overlay.animate = animate
  surface.getBoundingClientRect = () => ({ height: 800 })
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      constructor(value) {
        this.m42 = Number(value.match(/translate3d\(0, ([\d.]+)px/)?.[1] || 0)
      }
    }
  )
  const captures = new Set()
  handle.setPointerCapture = (id) => captures.add(id)
  handle.hasPointerCapture = (id) => captures.has(id)
  handle.releasePointerCapture = (id) => captures.delete(id)
  sheet = createPlayerSheet(panel, handle)
})
afterEach(() => {
  sheet.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('Now Playing sheet', () => {
  it('fades instead of sliding with reduced motion and retains Escape semantics', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true })
    const opening = sheet.open()
    expect(transitions[0].frames).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(transitions[0].options.duration).toBe(120)
    await finish()
    await opening
    expect(scrollBehavior()).toBe('instant')
    panel.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(panel.open).toBe(true)
    expect(surface.inert).toBe(true)
    await finish()
    expect(panel.open).toBe(false)
  })
  it('keeps the modal open when reopening interrupts dismissal, without resetting scroll', async () => {
    const first = sheet.open()
    await finish()
    await first
    panel.querySelector('.player-screen').scrollTop = 200
    const closing = sheet.close()
    const reopening = sheet.open()
    await finish()
    await Promise.all([closing, reopening])
    expect(panel.open).toBe(true)
    expect(surface.inert).toBe(false)
    expect(panel.querySelector('.player-screen').scrollTop).toBe(200)
    expect(sheet.open()).toBe(reopening)
  })
  it('restores the opener and original body styles only after the visual exit', async () => {
    const opener = document.querySelector('#opener')
    document.body.style.position = 'relative'
    const opening = sheet.open(opener)
    await finish()
    await opening
    expect(document.activeElement.id).toBe('player-heading')
    expect(document.body.style.position).toBe('fixed')
    const closing = sheet.close()
    expect(panel.open).toBe(true)
    await finish()
    await closing
    expect(document.body.style.position).toBe('relative')
    expect(document.activeElement).toBe(opener)
    document.body.style.position = ''
  })
  it('starts an interrupted drag at the visible offset and bounds upward movement', async () => {
    const opening = sheet.open()
    surface.style.transform = 'translate3d(0, 180px, 0)'
    pointer('pointerdown', 0, 20, 0)
    pointer('pointermove', 0, 50, 40)
    expect(surface.style.transform).toBe('translate3d(0, 210px, 0)')
    pointer('pointermove', 0, -300, 80)
    expect(surface.style.transform).toBe('translate3d(0, 0px, 0)')
    pointer('pointercancel', 0, -300, 100)
    await finish()
    await opening
    expect(panel.open).toBe(true)
  })
  it('ignores horizontal intent, secondary pointers, and tiny handle movements', async () => {
    const opening = sheet.open()
    await finish()
    await opening
    pointer('pointerdown', 10, 0, 0)
    pointer('pointermove', 10, 80, 20, 2)
    pointer('pointermove', 14, 4, 30)
    expect(surface.style.transform).toBe('')
    pointer('pointermove', 40, 6, 40)
    pointer('pointerup', 40, 6, 50)
    expect(panel.open).toBe(true)
    expect(handle.hasPointerCapture(1)).toBe(false)
  })
  it('uses recent release velocity: a held pull returns, a quick flick dismisses', async () => {
    const opening = sheet.open()
    await finish()
    await opening
    pointer('pointerdown', 0, 0, 0)
    pointer('pointermove', 0, 120, 40)
    expect(overlay.style.opacity).toBe('0.85')
    pointer('pointerup', 0, 120, 300)
    await finish()
    expect(panel.open).toBe(true)
    pointer('pointerdown', 0, 0, 400)
    pointer('pointermove', 0, 50, 430)
    pointer('pointerup', 0, 70, 450)
    await finish()
    expect(panel.open).toBe(false)
  })
  it('returns after lost capture and releases all listeners on disposal', async () => {
    const opening = sheet.open()
    await finish()
    await opening
    pointer('pointerdown', 0, 0, 0)
    pointer('pointermove', 0, 500, 500)
    pointer('lostpointercapture', 0, 500, 510)
    await finish()
    expect(panel.open).toBe(true)
    sheet.dispose()
    await sheet.open()
    pointer('pointerdown', 0, 0, 600)
    expect(handle.hasPointerCapture(1)).toBe(false)
    expect(panel.open).toBe(false)
    expect(document.body.style.position).not.toBe('fixed')
  })
})

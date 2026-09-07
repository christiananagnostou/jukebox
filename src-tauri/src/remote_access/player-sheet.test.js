// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayerSheet, scrollBehavior } from './player-sheet.js'

let panel, handle, sheet
beforeEach(() => {
  document.body.innerHTML = '<dialog><div id="handle"></div></dialog>'
  panel = document.querySelector('dialog')
  handle = document.querySelector('#handle')
  sheet = createPlayerSheet(panel, handle)
})
describe('Now Playing sheet', () => {
  it('retains dialog semantics and Escape dismissal with reduced motion', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true })
    panel.animate = vi.fn()
    await sheet.open()
    expect(panel.open).toBe(true)
    expect(panel.animate).not.toHaveBeenCalled()
    expect(scrollBehavior()).toBe('instant')
    panel.dispatchEvent(new Event('cancel', { cancelable: true }))
    await Promise.resolve()
    expect(panel.open).toBe(false)
    vi.restoreAllMocks()
  })
  it('keeps the sheet open when a reopen supersedes an unfinished close', async () => {
    const transitions = []
    panel.animate = vi.fn(() => {
      let resolve
      const finished = new Promise((r) => {
        resolve = r
      })
      const animation = { finished, cancel: () => resolve() }
      transitions.push({ resolve, animation })
      return animation
    })
    const first = sheet.open()
    transitions[0].resolve()
    await first
    const closing = sheet.close()
    const reopening = sheet.open()
    transitions.at(-1).resolve()
    await Promise.all([closing, reopening])
    expect(panel.open).toBe(true)
    const last = sheet.close()
    transitions.at(-1).resolve()
    await last
    expect(panel.open).toBe(false)
  })
})

import { createDOM } from '@builder.io/qwik/testing'
import { describe, expect, it } from 'vitest'
import { PageToolbar } from './PageToolbar'

describe('page toolbar', () => {
  it('keeps a single page heading and contextual actions in the panel bar', async () => {
    const { render, screen, userEvent } = await createDOM()
    await render(
      <PageToolbar title="Songs" id="songs-title">
        <button>Columns</button>
      </PageToolbar>
    )
    await userEvent(screen, 'renderFlush')
    expect(screen.querySelectorAll('h1').length).toBe(1)
    expect(screen.querySelector('#songs-title')?.textContent).toBe('Songs')
    expect(screen.querySelector('.page-toolbar-actions button')?.textContent).toBe('Columns')
    expect(screen.querySelector('header')?.hasAttribute('stoppropagation:keydown')).toBe(true)
  })
  it('uses a subordinate heading for a selected collection', async () => {
    const { render, screen } = await createDOM()
    await render(<PageToolbar title="Favorites" secondary />)
    expect(screen.querySelector('h1')).toBeFalsy()
    expect(screen.querySelector('h2')?.textContent).toBe('Favorites')
  })
  it('dismisses menus with Escape and outside clicks, without running page shortcuts', async () => {
    const { render, screen, userEvent } = await createDOM()
    await render(
      <PageToolbar title="Songs">
        <details open>
          <summary>Columns</summary>
          <button>Reset</button>
        </details>
      </PageToolbar>
    )
    await userEvent(screen, 'renderFlush')
    const menu = screen.querySelector('details')!
    const event = screen.ownerDocument.createEvent('Event')
    event.initEvent('keydown', true, true)
    Object.assign(event, { key: 'Escape' })
    screen.querySelector('button')!.dispatchEvent(event)
    expect(menu.open).toBe(false)
    menu.open = true
    const outside = screen.ownerDocument.createEvent('Event')
    outside.initEvent('pointerdown', true, true)
    screen.dispatchEvent(outside)
    expect(menu.open).toBe(false)
  })
})

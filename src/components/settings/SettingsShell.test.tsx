import { createDOM } from '@builder.io/qwik/testing'
import { describe, expect, it, vi } from 'vitest'
import { SettingsShell } from './SettingsShell'

vi.mock('@builder.io/qwik-city', () => ({ Link: (props: { children?: unknown }) => props.children ?? null }))

describe('settings panel layout', () => {
  it('keeps the title, section navigation and utilities above scrollable settings', async () => {
    const { render, screen } = await createDOM()
    await render(
      <SettingsShell title="Library settings" description="Manage sources." current="library" hasActions>
        <div q:slot="actions">
          <button>Add folder</button>
        </div>
        <section id="settings-body">Music folders</section>
      </SettingsShell>
    )
    expect(screen.querySelectorAll('h1').length).toBe(1)
    expect(screen.querySelector('.page-toolbar h1')?.textContent).toBe('Library settings')
    expect(screen.querySelector('.page-toolbar nav')).toBeTruthy()
    expect(screen.querySelector('.page-toolbar button')?.textContent).toBe('Add folder')
    expect(screen.querySelector('.workspace-page #settings-body')).toBeTruthy()
    expect(screen.querySelector('.workspace-page h1')).toBeFalsy()
    expect(screen.querySelector('.workspace-page button')).toBeFalsy()
  })
})

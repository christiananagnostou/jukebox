import { describe, expect, it } from 'vitest'

import { isNavigationRouteActive, matchesNavigationShortcut, NAVIGATION_COMMANDS } from './app-commands'

describe('navigation commands', () => {
  it('keeps route shortcuts unique and memorable', () => {
    const routeCommands = NAVIGATION_COMMANDS.filter((command) => command.href)
    const shortcuts = routeCommands.map((command) => command.shortcut)

    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    expect(routeCommands.map(({ id, shortcut }) => [id, shortcut])).toEqual([
      ['listen', 'H'],
      ['songs', 'L'],
      ['albums', 'M'],
      ['artists', 'A'],
      ['playlists', 'P'],
      ['folders', 'F'],
      ['import', 'I'],
      ['remote', 'R'],
      ['settings', 'S'],
    ])
  })

  it('matches only an unmodified Shift shortcut', () => {
    const event = { altKey: false, ctrlKey: false, key: 'I', metaKey: false, shiftKey: true }

    expect(matchesNavigationShortcut(event, 'I')).toBe(true)
    expect(matchesNavigationShortcut({ ...event, shiftKey: false }, 'I')).toBe(false)
    expect(matchesNavigationShortcut({ ...event, metaKey: true }, 'I')).toBe(false)
  })

  it('treats the Listen root as exact and nested routes as active', () => {
    expect(isNavigationRouteActive('/', '/')).toBe(true)
    expect(isNavigationRouteActive('/songs/', '/')).toBe(false)
    expect(isNavigationRouteActive('/songs/', '/songs/')).toBe(true)
    expect(isNavigationRouteActive('/songs/detail/', '/songs/')).toBe(true)
  })
})

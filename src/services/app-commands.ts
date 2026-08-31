export type NavigationGroup = 'primary' | 'library' | 'tools' | 'utility'

export type NavigationIconName =
  'album' | 'artist' | 'folder' | 'import' | 'keyboard' | 'listen' | 'playlist' | 'settings' | 'songs'

export interface NavigationCommand {
  group: NavigationGroup
  href?: string
  icon: NavigationIconName
  id: string
  label: string
  shortcut?: string
}

export interface KeyboardCommandGroup {
  commands: Array<{ command: string; key: string }>
  title: string
  type: 'header'
}

export const NAVIGATION_COMMANDS: readonly NavigationCommand[] = [
  { group: 'primary', href: '/', icon: 'listen', id: 'listen', label: 'Listen', shortcut: 'H' },
  { group: 'library', href: '/songs/', icon: 'songs', id: 'songs', label: 'Songs', shortcut: 'L' },
  { group: 'library', href: '/albums/', icon: 'album', id: 'albums', label: 'Albums', shortcut: 'M' },
  { group: 'library', href: '/artists/', icon: 'artist', id: 'artists', label: 'Artists', shortcut: 'A' },
  { group: 'library', href: '/playlists/', icon: 'playlist', id: 'playlists', label: 'Playlists', shortcut: 'P' },
  { group: 'library', href: '/storage/', icon: 'folder', id: 'folders', label: 'Folders', shortcut: 'F' },
  { group: 'tools', href: '/import/', icon: 'import', id: 'import', label: 'Import music', shortcut: 'I' },
  { group: 'utility', href: '/settings/', icon: 'settings', id: 'settings', label: 'Settings', shortcut: 'S' },
  { group: 'utility', icon: 'keyboard', id: 'shortcuts', label: 'Shortcuts' },
] as const

const pageCommands = NAVIGATION_COMMANDS.filter(
  (command): command is NavigationCommand & { href: string; shortcut: string } =>
    Boolean(command.href && command.shortcut)
).map((command) => ({ command: command.label, key: `⇧ ${command.shortcut}` }))

export const KEYBOARD_COMMAND_GROUPS: readonly KeyboardCommandGroup[] = [
  {
    type: 'header',
    title: 'Movement',
    commands: [
      { key: 'j', command: 'Move down' },
      { key: 'k', command: 'Move up' },
      { key: 'h', command: 'Move left / up a folder' },
      { key: 'l', command: 'Move right / open a folder' },
      { key: 'g', command: 'Move to list top' },
      { key: 'G', command: 'Move to list bottom' },
    ],
  },
  {
    type: 'header',
    title: 'Playback',
    commands: [
      { key: 'Enter', command: 'Play selection' },
      { key: 'p', command: 'Play or pause' },
      { key: 'n', command: 'Next track' },
      { key: '⇧ N', command: 'Previous track' },
      { key: 'q', command: 'Add selection to queue' },
    ],
  },
  { type: 'header', title: 'Go to', commands: pageCommands },
  {
    type: 'header',
    title: 'Utility',
    commands: [
      { key: '/', command: 'Focus search' },
      { key: '?', command: 'Show or hide shortcuts' },
      { key: 'Escape', command: 'Close the active overlay' },
    ],
  },
]

export function isNavigationRouteActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`
  return normalizedPath.startsWith(href)
}

export function matchesNavigationShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  shortcut: string
): boolean {
  return (
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.key.toUpperCase() === shortcut.toUpperCase()
  )
}

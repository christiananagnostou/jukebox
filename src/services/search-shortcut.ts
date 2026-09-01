export interface SearchShortcutEvent {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
}

export function shouldFocusLibrarySearch(event: SearchShortcutEvent, isTyping: boolean): boolean {
  return event.key === '/' && !isTyping && !event.altKey && !event.ctrlKey && !event.metaKey
}

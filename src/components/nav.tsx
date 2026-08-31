import { component$, useContext } from '@builder.io/qwik'
import { Link, useLocation } from '@builder.io/qwik-city'

import { StoreContext } from '~/routes/layout'
import { isNavigationRouteActive, NAVIGATION_COMMANDS, type NavigationCommand } from '~/services/app-commands'
import { ShortcutsModal } from './Shared/ShortcutsModal'
import { NavigationIcon } from './svg/NavigationIcon'

const commandsFor = (group: NavigationCommand['group']) =>
  NAVIGATION_COMMANDS.filter((command) => command.group === group)

const primaryCommands = commandsFor('primary')
const libraryCommands = commandsFor('library')
const toolCommands = commandsFor('tools')
const utilityCommands = commandsFor('utility')

const NavigationLink = component$((props: { command: NavigationCommand; pathname: string }) => {
  const { command, pathname } = props
  if (!command.href) return null
  const active = isNavigationRouteActive(pathname, command.href)

  return (
    <Link
      href={command.href}
      class="nav-index-link"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
      title={command.shortcut ? `${command.label} (Shift+${command.shortcut})` : command.label}
    >
      <span class="nav-index-marker" aria-hidden="true" />
      <span class="nav-index-icon">
        <NavigationIcon name={command.icon} />
      </span>
      <span class="min-w-0 flex-1 truncate">{command.label}</span>
      {command.shortcut && <kbd class="nav-index-shortcut">⇧{command.shortcut}</kbd>}
    </Link>
  )
})

export default component$(() => {
  const store = useContext(StoreContext)
  const location = useLocation()
  const pathname = location.url.pathname
  const libraryBusy = store.sync.status === 'scanning' || store.sync.status === 'importing'
  const libraryNeedsAttention = store.sync.status === 'error' || Boolean(store.bootstrap.libraryError)
  const statusLabel = libraryBusy
    ? store.sync.message || (store.sync.status === 'scanning' ? 'Scanning library' : 'Importing music')
    : 'Library needs attention'

  return (
    <>
      <nav class="app-navigation" aria-label="Primary navigation">
        <header class="nav-index-header">
          <span class="nav-index-brand-mark" aria-hidden="true">
            <span />
          </span>
          <span class="min-w-0">
            <strong class="block truncate text-[13px] font-semibold tracking-wide text-slate-100">Jukebox</strong>
            <span class="mt-1 block font-mono text-[10px] tabular-nums text-slate-500">
              {store.libraryCatalog.total.toLocaleString()} {store.libraryCatalog.total === 1 ? 'track' : 'tracks'}
            </span>
          </span>
        </header>

        <div class="nav-index-scroll">
          <div class="nav-index-primary">
            {primaryCommands.map((command) => (
              <NavigationLink command={command} pathname={pathname} key={command.id} />
            ))}
          </div>

          <section aria-labelledby="library-navigation-heading">
            <h2 id="library-navigation-heading" class="nav-index-heading">
              Library
            </h2>
            {libraryCommands.map((command) => (
              <NavigationLink command={command} pathname={pathname} key={command.id} />
            ))}
          </section>

          <section class="mt-4" aria-labelledby="tools-navigation-heading">
            <h2 id="tools-navigation-heading" class="nav-index-heading">
              Tools
            </h2>
            {toolCommands.map((command) => (
              <NavigationLink command={command} pathname={pathname} key={command.id} />
            ))}
          </section>
        </div>

        <footer class="nav-index-footer">
          {(libraryBusy || libraryNeedsAttention) && (
            <Link class="nav-index-status" href="/settings/library/" title={`${statusLabel}. Open Library settings.`}>
              <span class="nav-index-status-dot" data-state={libraryBusy ? 'busy' : 'error'} aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{statusLabel}</span>
            </Link>
          )}

          {utilityCommands.map((command) =>
            command.href ? (
              <NavigationLink command={command} pathname={pathname} key={command.id} />
            ) : (
              <button
                class="nav-index-link"
                key={command.id}
                type="button"
                onClick$={() => (store.showKeyShortcuts = !store.showKeyShortcuts)}
                aria-expanded={store.showKeyShortcuts}
              >
                <span class="nav-index-marker" aria-hidden="true" />
                <span class="nav-index-icon">
                  <NavigationIcon name={command.icon} />
                </span>
                <span class="min-w-0 flex-1 truncate text-left">{command.label}</span>
                <kbd class="nav-index-shortcut">?</kbd>
              </button>
            )
          )}
        </footer>
      </nav>

      {store.showKeyShortcuts && <ShortcutsModal />}
    </>
  )
})

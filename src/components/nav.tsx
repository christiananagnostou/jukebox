import { component$, useContext } from '@builder.io/qwik'
import { Link, useLocation } from '@builder.io/qwik-city'
import { StoreContext } from '~/routes/layout'
import MusicPicker from './Shared/MusicPicker'
import { ShortcutsModal } from './Shared/ShortcutsModal'

const Links = [
  { title: 'Library', url: '/', shortcut: 'L' },
  { title: 'Artists', url: '/artists/', shortcut: 'A' },
  { title: 'Storage', url: '/storage/', shortcut: 'O' },
  { title: 'Albums', url: '/albums/', shortcut: 'M' },
  { title: 'Settings', url: '/settings/', shortcut: 'S' },
]

const NavItemStyles = {
  button: 'w-full flex items-center justify-between p-2 hover:bg-gray-700 group',
  icon: 'text-xs text-gray-500 group-hover:text-gray-400',
}

export default component$(() => {
  const store = useContext(StoreContext)
  const location = useLocation()

  return (
    <>
      <nav class="app-navigation border-r border-gray-700 h-screen min-w-0 flex z-20 flex-col text-sm">
        <div class="flex-1 mt-[29px] border-t border-gray-700">
          {Links.map((link) => (
            <Link
              key={link.title}
              href={link.url}
              title={link.title}
              class={NavItemStyles.button + ` ${location?.url?.pathname === link.url ? '!bg-gray-700' : ''}`}
            >
              {link.title}

              <span class={NavItemStyles.icon}>{link.shortcut}</span>
            </Link>
          ))}
        </div>

        <MusicPicker styles={NavItemStyles} />

        <button class={NavItemStyles.button} onClick$={() => (store.showKeyShortcuts = !store.showKeyShortcuts)}>
          Shortcuts
          <span class={NavItemStyles.icon}>?</span>
        </button>
      </nav>

      {store.showKeyShortcuts && <ShortcutsModal />}
    </>
  )
})

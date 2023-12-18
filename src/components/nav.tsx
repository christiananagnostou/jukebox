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
      <nav
        class="border-r border-gray-700 fixed top-0 left-0 h-screen flex z-20 flex-col text-sm"
        style={{ width: 'var(--navbar-width)' }}
      >
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

        <p class={NavItemStyles.button + ` text-slate-400 text-sm`}>{store.allSongs.length} songs</p>
      </nav>

      {store.showKeyShortcuts && <ShortcutsModal />}
    </>
  )
})

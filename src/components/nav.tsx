import { component$, useContext } from '@builder.io/qwik'
import { Link, useLocation } from '@builder.io/qwik-city'
import { StoreContext } from '~/routes/layout'
import MusicPicker from './Shared/MusicPicker'
import { ShortcutsModal } from './Shared/ShortcutsModal'

const Links = [
  { title: 'Library', url: '/', shortcut: 'L' },
  { title: 'Artists', url: '/artists/', shortcut: 'A' },
  { title: 'Storage', url: '/storage/', shortcut: 'O' },
]

export default component$(() => {
  const store = useContext(StoreContext)
  const location = useLocation()

  return (
    <>
      <nav
        class="border-r border-gray-700 fixed top-0 left-0 h-screen flex z-20 flex-col text-sm"
        style={{ width: 'var(--navbar-width)' }}
      >
        <ul class="flex-1 mt-[29px] border-t border-gray-700">
          {Links.map((link) => (
            <li key={link.title} class="p-1">
              <Link
                href={link.url}
                title={link.title}
                class={`w-full flex items-center justify-between py-1 px-2 border border-transparent hover:border-gray-700 rounded 
              ${location?.url?.pathname === link.url ? '!border-gray-700' : ''}`}
              >
                {link.title}

                <span class="text-[.6rem] text-gray-500">{link.shortcut}</span>
              </Link>
            </li>
          ))}

          <hr class="border-slate-700" />

          <li class="p-1">
            <MusicPicker />
          </li>

          <li class="p-1">
            <button
              class="w-full flex items-center justify-between py-1 px-2 border border-transparent hover:border-gray-700 rounded"
              onClick$={() => (store.showKeyShortcuts = !store.showKeyShortcuts)}
            >
              Shortcuts
              <span class="text-xs text-gray-500">?</span>
            </button>
          </li>
        </ul>
      </nav>

      {store.showKeyShortcuts && <ShortcutsModal />}
    </>
  )
})

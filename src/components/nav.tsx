import { component$, useContext } from '@builder.io/qwik'
import { Link, useLocation } from '@builder.io/qwik-city'
import { StoreContext } from '~/routes/layout'
import { Backspace } from './svg/Backspace'
import { Command } from './svg/Command'
import { Shift } from './svg/Shift'
import MusicPicker from './Shared/MusicPicker'

const Links = [
  { title: 'Library', url: '/', shortcut: 'L' },
  { title: 'Artists', url: '/artists/', shortcut: 'A' },
  // { title: 'Playlists', url: '/playlists/', shortcut: 'P' },
]

const KeyboardCommands = [
  { type: 'header', title: 'Movement' },
  { key: 'j', command: 'Highlight Down' },
  { key: 'k', command: 'Highlight Up' },
  { key: 'g', command: 'Highlight to Top' },
  { key: 'G', command: 'Highlight to Bottom' },

  { type: 'header', title: 'Audio Control' },
  { key: 'n', command: 'Next Song' },
  { key: '⇧ N', command: 'Prev Song' },
  { key: 'p', command: 'Pause/Play' },
  { key: 'q', command: 'Add Song to Queue' },
  // { key: 's', command: 'Seek Forward' },
  // { key: '⇧ S', command: 'Seek Back' },

  { type: 'header', title: 'Pages' },
  { key: '⇧ L', command: 'Library' },
  { key: '⇧ A', command: 'Artists' },
  { key: '⇧ P', command: 'Playlists' },

  { type: 'header', title: 'Utility' },
  { key: '/', command: 'Search' },
  { key: '⇧ I', command: 'Import Files' },
  { key: '?', command: 'Toggle Shortcuts' },
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

      {store.showKeyShortcuts && (
        <div
          class="fixed z-30 inset-0 h-full w-full grid place-items-center bg-[var(--modal-background)]"
          onClick$={() => (store.showKeyShortcuts = !store.showKeyShortcuts)}
        >
          {/* Modal */}
          <div class="px-4 w-max h-max border border-slate-700 rounded bg-[var(--body-bg-solid)]">
            {KeyboardCommands.map((shortcut) => (
              <span key={shortcut.command} class="flex justify-between my-4 w-64 text-sm">
                {shortcut.type === 'header' ? (
                  <span class="pb-1 -mb-1 border-b border-slate-700 w-full text-gray-200 text-center">
                    {shortcut.title}
                  </span>
                ) : (
                  <>
                    <span>{shortcut.command}</span>

                    <span class="flex align-center">
                      {shortcut.key?.split(' ').map((key) => (
                        <kbd
                          key={key}
                          class="ml-1 text-[10px] leading-[110%] py-[4px] px-[3px] min-w-[20px] inline-grid place-items-center text-center rounded bg-gray-700"
                        >
                          {(() => {
                            if (key === '⇧') return <Shift />
                            if (key === '⌘') return <Command />
                            if (key === '⌫') return <Backspace />
                            return key
                          })()}
                        </kbd>
                      ))}
                    </span>
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
})

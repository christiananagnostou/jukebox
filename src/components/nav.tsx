import { $, type QwikChangeEvent, component$, useContext, useStore } from '@builder.io/qwik'
import { Link } from '@builder.io/qwik-city'
import { NextTrack } from '~/components/svg/NextTrack'
import { Pause } from '~/components/svg/Pause'
import { Play } from '~/components/svg/Play'
import { PrevTrack } from '~/components/svg/PrevTrack'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { Backspace } from './svg/backspace'
import { Command } from './svg/command'
import { Shift } from './svg/shift'
import { Keyboard } from './svg/keyboard'

const Links = [
  { title: 'Library', url: '/' },
  { title: 'Albums', url: '/' },
  { title: 'Playlists', url: '/' },
  { title: 'Import', url: '/' },
]

const KeyboardCommands = [
  // { key: '⇧ Click', command: 'Move' },
  // { key: 'F Click', command: 'Bring to Front' },
  // { key: '⌘ Scroll', command: 'Zoom' },
  { key: '^ i', command: 'Import Files' },
  { key: 'j', command: 'Down' },
  { key: 'k', command: 'up' },
  { key: 'n', command: 'Next Song' },
  { key: 'N', command: 'Prev Song' },
  { key: 'p', command: 'Pause/Play' },
  { key: '/', command: 'Search' },
]

export default component$(() => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const state = useStore({ showKeyShortcuts: true })

  const dragHandler = $((e: QwikChangeEvent<HTMLInputElement>) => {
    if (!store.player.audioElem) return
    const currentDraggedTime = parseInt(e.target.value)
    store.player.audioElem.currentTime = currentDraggedTime
  })

  const formatSeconds = $((time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    const secondsWithZero = String(seconds).padStart(2, '0')
    return `${minutes}:${secondsWithZero}`
  })

  return (
    <nav
      class="border-r border-gray-700 fixed top-0 h-screen flex z-20 flex-col text-sm"
      style={{ width: 'var(--navbar-width' }}
    >
      <ul class="flex-1 mt-[29px] border-t border-gray-700">
        {Links.map((link) => (
          <li key={link.title} class="p-1">
            <Link
              href={link.url}
              title={link.title}
              class="block py-1 px-2 border border-transparent hover:border-gray-700 rounded"
            >
              {link.title}
            </Link>
          </li>
        ))}
      </ul>

      <div class="border-b border-gray-700 p-1">
        <button
          class="flex items-center w-full py-1 px-2 border border-transparent hover:border-gray-700 rounded"
          onClick$={() => (state.showKeyShortcuts = !state.showKeyShortcuts)}
        >
          <Keyboard />
          <span class="pl-2">Shortcuts</span>
        </button>

        {state.showKeyShortcuts && (
          <div
            class="fixed inset-0 h-full w-full grid place-items-center bg-[var(--modal-background)]"
            onClick$={() => (state.showKeyShortcuts = !state.showKeyShortcuts)}
          >
            {/* Modal */}
            <div class="px-8 w-max h-max border border-slate-700 rounded bg-[var(--body-background)]">
              {KeyboardCommands.map((shortcut) => (
                <span key={shortcut.command} class="flex justify-between my-3 w-48">
                  <span>{shortcut.command}</span>{' '}
                  <span class="flex align-center">
                    {shortcut.key.split(' ').map((key) => (
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
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div class="text-center text-sm group/nav-player">
        {/* Album Art */}
        {/* <div class="w-full px-2 aspect-square bg-gray-800"><img src="" alt="" /></div> */}
        {/* Tile */}
        <p class="h-5 truncate">{store.player.currSong?.title}</p>
        {/* Artist */}
        <p class="h-5 truncate">{store.player.currSong?.artist}</p>

        {/* Controls */}
        <div class="flex justify-evenly text-slate-500 mt-4">
          <button onClick$={storeActions.prevSong}>
            <PrevTrack />
          </button>
          {store.player.isPaused ? (
            <button onClick$={storeActions.resumeSong}>
              <Play />
            </button>
          ) : (
            <button onClick$={storeActions.pauseSong}>
              <Pause />
            </button>
          )}
          <button onClick$={storeActions.nextSong}>
            <NextTrack />
          </button>
        </div>

        {/* Range Slider */}
        <div>
          <div class="flex justify-between w-full opacity-0 text-xs text-slate-400 group-hover/nav-player:opacity-100 transition-opacity duration-300">
            <p class="px-1">{formatSeconds(store.player.currentTime)}</p>
            <p class="px-1">{formatSeconds(store.player.duration)}</p>
          </div>

          <div class="w-full relative overflow-hidden h-2">
            <input
              class="appearance-none w-full block"
              type="range"
              min={0}
              max={store.player.duration}
              value={store.player.currentTime}
              onChange$={dragHandler}

              // TODO: get color from album art
              // style={{
              //   background: `linear-gradient(to right, ${store.player.currSong.color[0]}, ${store.player.currentSong.color[1]})`,
              // }}
            />
            {store.player.audioElem && (
              <div
                class="bg-slate-500 w-full h-full absolute left-0 top-0 pointer-events-none"
                style={{
                  transform: `translateX(${(store.player.currentTime / store.player.duration) * 100}%)`,
                }}
              ></div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
})

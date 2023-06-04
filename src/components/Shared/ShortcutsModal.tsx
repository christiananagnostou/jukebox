import { component$, useContext } from '@builder.io/qwik'
import { KeyboardCommands } from '~/hooks/useKeyboardShortcuts'
import { StoreContext } from '~/routes/layout'
import { Backspace } from '../svg/Backspace'
import { Command } from '../svg/Command'
import { Shift } from '../svg/Shift'

export const ShortcutsModal = component$(() => {
  const store = useContext(StoreContext)

  return (
    <div
      class="fixed z-30 inset-0 h-full w-full grid place-items-center bg-[var(--modal-background)]"
      onClick$={() => (store.showKeyShortcuts = !store.showKeyShortcuts)}
    >
      {/* Modal */}
      <div class="p-8 w-max h-max grid grid-cols-2 gap-12 border border-slate-700 rounded bg-[var(--body-bg-solid)]">
        {KeyboardCommands.map((shortcutGroup, i) => (
          <div key={i}>
            <span class="pb-2 -mb-1 border-b border-slate-700 w-full text-gray-200 text-center block">
              {shortcutGroup.title}
            </span>

            {shortcutGroup.commands.map((shortcut) => (
              <span key={shortcut.command} class="flex justify-between mt-4 w-64 text-sm">
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
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
})

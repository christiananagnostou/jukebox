import { $, component$, useContext, useOnWindow, useVisibleTask$ } from '@builder.io/qwik'
import type { Event } from '@tauri-apps/api/event'
import { listen } from '@tauri-apps/api/event'
import { message } from '@tauri-apps/plugin-dialog'

import { useLibraryImporter } from '~/hooks/useLibraryImporter'
import { StoreContext } from '~/routes/layout'
import { pickMusicFolders } from '~/services/dialog-client'
import { getErrorMessage } from '~/utils/Errors'

export default component$(({ styles }: { styles: { button: string; icon: string } }) => {
  const store = useContext(StoreContext)
  const { importPaths } = useLibraryImporter(store)

  const importAndReport = $(async (paths: string[]) => {
    try {
      const result = await importPaths(paths)
      if (result.errors.length) {
        await message(
          `Added ${result.folders} folder(s) and imported ${result.imported} file(s); ${result.errors.length} failed.\n\n${result.errors.slice(0, 5).join('\n')}`,
          { kind: 'warning', title: 'Jukebox import' }
        )
      }
    } catch (error) {
      await message(getErrorMessage(error), { kind: 'error', title: 'Jukebox import failed' })
    }
  })

  const openDirectoryPicker = $(async () => {
    const selected = await pickMusicFolders({
      multiple: true,
      defaultPath: store.settings.musicFolder || undefined,
    })

    if (selected.length) await importAndReport(selected)
  })

  useVisibleTask$(async () => {
    return listen<string[]>('tauri://file-drop', async (event: Event<string[]>) => {
      if (event.payload?.length) await importAndReport(event.payload)
    })
  })

  useOnWindow(
    'keydown',
    $((event: globalThis.Event) => {
      const keyboardEvent = event as KeyboardEvent
      if (keyboardEvent.shiftKey && keyboardEvent.key.toLowerCase() === 'i') {
        keyboardEvent.preventDefault()
        openDirectoryPicker()
      }
    })
  )

  return (
    <button onClick$={openDirectoryPicker} class={styles.button}>
      Import Music
      <span class={styles.icon}>I</span>
    </button>
  )
})

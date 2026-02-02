import { $, component$, useContext, useOnWindow, useVisibleTask$ } from '@builder.io/qwik'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'

import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { useLibraryScanner } from '~/hooks/useLibraryScanner'

// const WINDOW_FILE_DROP = 'tauri://file-drop'
// const WINDOW_FILE_DROP_HOVER = 'tauri://file-drop-hover'
// const WINDOW_FILE_DROP_CANCELLED = 'tauri://file-drop-cancelled'

export default component$(({ styles }: { styles: { button: string; icon: string } }) => {
  const store = useContext(StoreContext)
  const storeActions = useContext(StoreActionsContext)
  const { scanDirectory, scanDirectories } = useLibraryScanner(store, storeActions)

  /**
   *
   * Open a import dialog for directories and add selected
   *
   */
  const openDirectoryPicker = $(async () => {
    const selected = await open({
      directory: true,
      multiple: true,
      defaultPath: store.settings.musicFolder,
    })

    if (Array.isArray(selected)) {
      // User selected multiple directories
      await scanDirectories(selected, 'import')
    } else if (selected === null) {
      // User cancelled the selection
    } else {
      // User selected a single directory
      await scanDirectory(selected, 'import')
    }
  })

  /**
   *
   * Add listener for file drop on the app
   *
   */
  useVisibleTask$(async () => {
    const unlistenFileDrop = await listen('tauri://file-drop', async (event: any) => {
      if (!event.payload) return
      await scanDirectories(event.payload as string[], 'import')
    })

    return () => unlistenFileDrop()
  })

  /**
   *
   * Add keyboard event for Shift + I to open import dialog
   *
   */
  useOnWindow(
    'keydown',
    $((e: Event) => {
      // @ts-ignore
      const { key } = e as { key: string }
      if (key === 'I') openDirectoryPicker()
    })
  )

  return (
    <button onClick$={openDirectoryPicker} class={styles.button}>
      Import Music
      <span class={styles.icon}>I</span>
    </button>
  )
})

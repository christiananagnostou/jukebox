import { $, component$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { Link, type DocumentHead } from '@builder.io/qwik-city'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import { useLibraryImporter } from '~/hooks/useLibraryImporter'
import { StoreContext } from '../layout'
import { pickMusicFolders } from '~/services/dialog-client'
import { getErrorMessage } from '~/utils/Errors'

export default component$(() => {
  const store = useContext(StoreContext)
  const { importPaths } = useLibraryImporter(store)
  const state = useStore({
    action: '',
    error: '',
    errors: [] as string[],
    folders: 0,
    imported: 0,
    selectionCount: 0,
  })

  const runImport = $(async (paths: string[]) => {
    if (!paths.length || state.action) return
    state.action = 'import'
    state.error = ''
    state.errors = []
    state.folders = 0
    state.imported = 0
    state.selectionCount = paths.length
    try {
      const result = await importPaths(paths)
      state.errors = result.errors
      state.folders = result.folders
      state.imported = result.imported
    } catch (error) {
      state.error = getErrorMessage(error)
    } finally {
      state.action = ''
    }
  })

  const chooseFolders = $(async () => {
    if (state.action) return
    state.action = 'picker'
    state.error = ''
    try {
      const selected = await pickMusicFolders({
        multiple: true,
        defaultPath: store.settings.musicFolder || undefined,
      })
      state.action = ''
      if (selected.length) await runImport(selected)
    } catch (error) {
      state.error = getErrorMessage(error)
      state.action = ''
    }
  })

  useVisibleTask$(({ cleanup }) => {
    let unlisten: UnlistenFn | undefined
    void listen<string[]>('tauri://file-drop', (event) => {
      if (event.payload?.length) void runImport(event.payload)
    }).then((stopListening) => {
      unlisten = stopListening
    })
    cleanup(() => unlisten?.())
  })

  const busy = Boolean(state.action) || store.sync.status === 'importing'
  const hasSummary = !busy && Boolean(state.selectionCount) && !state.error
  const progress = store.sync.total ? Math.min(100, (store.sync.processed / store.sync.total) * 100) : 0

  return (
    <section class="workspace-page" aria-labelledby="import-heading">
      <header class="workspace-header">
        <div>
          <h1 id="import-heading">Import music</h1>
          <p>Add folders for continuous library updates, or drop individual audio files for a one-time import.</p>
        </div>
        <Link class="workspace-link" href="/settings/library/">
          Manage music folders
        </Link>
      </header>

      <div class="import-layout">
        <section class="import-drop-zone" aria-labelledby="choose-music-heading" data-busy={busy ? 'true' : 'false'}>
          <span class="import-drop-mark" aria-hidden="true">
            +
          </span>
          <div>
            <h2 id="choose-music-heading">Choose music folders</h2>
            <p>
              Selected folders become managed library sources. You can also drag supported files or folders anywhere
              onto this window.
            </p>
          </div>
          <button class="workspace-primary-action" type="button" onClick$={chooseFolders} disabled={busy}>
            {state.action === 'picker' ? 'Opening…' : busy ? 'Importing…' : 'Choose folders'}
          </button>
          <p class="import-formats">MP3 · FLAC · ALAC/M4A · AAC · OGG · WAV</p>
        </section>

        <aside class="import-process" aria-labelledby="import-process-heading">
          <h2 id="import-process-heading">What happens</h2>
          <ol>
            <li>
              <span>1</span>
              <p>
                <strong>Inspect</strong>
                Jukebox validates dropped paths and supported audio types natively.
              </p>
            </li>
            <li>
              <span>2</span>
              <p>
                <strong>Index</strong>
                Metadata and artwork are read without loading your complete library into the interface.
              </p>
            </li>
            <li>
              <span>3</span>
              <p>
                <strong>Keep current</strong>
                Managed folders remain watched and can be refreshed or disabled later.
              </p>
            </li>
          </ol>
        </aside>
      </div>

      {busy && (
        <section class="import-status" aria-live="polite" aria-label="Import progress">
          <div>
            <strong>{store.sync.message || 'Preparing import'}</strong>
            <span>
              {store.sync.total
                ? `${store.sync.processed.toLocaleString()} of ${store.sync.total.toLocaleString()}`
                : 'Working'}
            </span>
          </div>
          <progress value={store.sync.total ? store.sync.processed : undefined} max={store.sync.total || undefined}>
            {progress}%
          </progress>
        </section>
      )}

      {state.error && (
        <p class="workspace-error" role="alert">
          {state.error}
        </p>
      )}

      {hasSummary && (
        <section class="import-summary" aria-labelledby="import-summary-heading">
          <div>
            <h2 id="import-summary-heading">
              {state.imported || state.folders
                ? 'Your library is updating'
                : state.errors.length
                  ? 'Some items need attention'
                  : 'No supported music was found'}
            </h2>
            <p>
              {state.folders.toLocaleString()} {state.folders === 1 ? 'folder' : 'folders'} added ·{' '}
              {state.imported.toLocaleString()} {state.imported === 1 ? 'file' : 'files'} imported
              {state.errors.length ? ` · ${state.errors.length.toLocaleString()} failed` : ''}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Link class="workspace-primary-action" href="/songs/">
              Browse songs
            </Link>
            <button class="workspace-secondary-action" type="button" onClick$={chooseFolders}>
              Add more
            </button>
          </div>
          {state.errors.length > 0 && (
            <details class="import-errors">
              <summary>Show {state.errors.length.toLocaleString()} import issues</summary>
              <ul>
                {state.errors.slice(0, 20).map((error, index) => (
                  <li key={`${index}:${error}`}>{error}</li>
                ))}
              </ul>
              {state.errors.length > 20 && <p>Showing the first 20 issues.</p>}
            </details>
          )}
        </section>
      )}
    </section>
  )
})

export const head: DocumentHead = {
  title: 'Import music · Jukebox',
  meta: [{ name: 'description', content: 'Add folders and audio files to your local Jukebox library.' }],
}

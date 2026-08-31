import { $, component$, useStore } from '@builder.io/qwik'
import type { DocumentHead } from '@builder.io/qwik-city'
import { invoke } from '@tauri-apps/api/core'

import { SettingsShell } from '~/components/settings/SettingsShell'
import { clearPlayHistory } from '~/services/history-client'
import { getErrorMessage } from '~/utils/Errors'

export default component$(() => {
  const state = useStore({
    diagnosticsAction: '' as '' | 'copy' | 'open',
    diagnosticsError: '',
    diagnosticsMessage: '',
    historyAction: '' as '' | 'clear' | 'confirm',
    historyError: '',
    historyMessage: '',
  })

  const clearHistory = $(async () => {
    if (state.historyAction !== 'confirm') return
    state.historyAction = 'clear'
    state.historyError = ''
    state.historyMessage = ''
    try {
      const result = await clearPlayHistory()
      state.historyMessage = result.affected
        ? `Cleared ${result.affected} listening ${result.affected === 1 ? 'entry' : 'entries'}.`
        : 'Listening history is already empty.'
    } catch (error) {
      state.historyError = getErrorMessage(error)
    } finally {
      state.historyAction = ''
    }
  })

  const runDiagnosticsAction = $(async (action: 'copy' | 'open') => {
    if (state.diagnosticsAction) return
    state.diagnosticsAction = action
    state.diagnosticsError = ''
    state.diagnosticsMessage = ''
    try {
      await invoke(action === 'copy' ? 'copy_diagnostics_summary' : 'open_diagnostics_directory')
      state.diagnosticsMessage = action === 'copy' ? 'Diagnostics summary copied.' : 'Diagnostics folder opened.'
    } catch (error) {
      state.diagnosticsError = getErrorMessage(error)
    } finally {
      state.diagnosticsAction = ''
    }
  })

  return (
    <SettingsShell
      current="privacy"
      title="Privacy & diagnostics"
      description="Review the small amount of local activity data Jukebox keeps and troubleshoot without exposing music paths."
    >
      <section class="settings-control-group" aria-labelledby="listening-history-heading">
        <header>
          <h2 id="listening-history-heading">Listening history</h2>
          <p>
            Jukebox keeps up to 10,000 plays for recent and frequently played views. Track paths are never stored in
            history.
          </p>
        </header>

        <div class="settings-action-row">
          {state.historyAction === 'confirm' ? (
            <>
              <button class="settings-danger-action" type="button" onClick$={clearHistory}>
                Confirm clear history
              </button>
              <button class="workspace-secondary-action" type="button" onClick$={() => (state.historyAction = '')}>
                Cancel
              </button>
            </>
          ) : (
            <button
              class="settings-danger-action"
              type="button"
              disabled={state.historyAction === 'clear'}
              onClick$={() => {
                state.historyAction = 'confirm'
                state.historyError = ''
                state.historyMessage = ''
              }}
            >
              {state.historyAction === 'clear' ? 'Clearing…' : 'Clear listening history…'}
            </button>
          )}
        </div>

        {state.historyMessage && (
          <p class="settings-message" data-tone="success" aria-live="polite">
            {state.historyMessage}
          </p>
        )}
        {state.historyError && (
          <p class="settings-message" data-tone="error" role="alert">
            {state.historyError}
          </p>
        )}
      </section>

      <section class="settings-control-group" aria-labelledby="diagnostics-heading">
        <header>
          <h2 id="diagnostics-heading">Diagnostics</h2>
          <p>
            Bounded local logs categorize errors while excluding music paths, filenames, device names, and private
            network addresses.
          </p>
        </header>

        <div class="settings-action-row">
          <button
            class="workspace-secondary-action"
            type="button"
            disabled={Boolean(state.diagnosticsAction)}
            onClick$={() => runDiagnosticsAction('copy')}
          >
            {state.diagnosticsAction === 'copy' ? 'Copying…' : 'Copy summary'}
          </button>
          <button
            class="workspace-secondary-action"
            type="button"
            disabled={Boolean(state.diagnosticsAction)}
            onClick$={() => runDiagnosticsAction('open')}
          >
            {state.diagnosticsAction === 'open' ? 'Opening…' : 'Open diagnostics folder'}
          </button>
        </div>

        {state.diagnosticsMessage && (
          <p class="settings-message" data-tone="success" aria-live="polite">
            {state.diagnosticsMessage}
          </p>
        )}
        {state.diagnosticsError && (
          <p class="settings-message" data-tone="error" role="alert">
            {state.diagnosticsError}
          </p>
        )}
      </section>
    </SettingsShell>
  )
})

export const head: DocumentHead = {
  title: 'Privacy & diagnostics · Jukebox',
  meta: [{ name: 'description', content: 'Manage Jukebox listening history and privacy-safe diagnostics.' }],
}

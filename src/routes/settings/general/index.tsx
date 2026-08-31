import { $, component$, useContext, useStore } from '@builder.io/qwik'
import type { DocumentHead } from '@builder.io/qwik-city'
import { invoke } from '@tauri-apps/api/core'

import type { Settings, SettingsSnapshot } from '~/App'
import { SettingsShell } from '~/components/settings/SettingsShell'
import { getErrorMessage } from '~/utils/Errors'
import { StoreContext } from '../../layout'

export default component$(() => {
  const store = useContext(StoreContext)
  const state = useStore({ busy: false, error: '' })

  const saveSettings = $(async (settings: Settings) => {
    if (state.busy) return
    state.busy = true
    state.error = ''
    try {
      const snapshot = await invoke<SettingsSnapshot>('set_settings', { settings })
      store.settings = snapshot.settings
      store.bootstrap.settingsWarning = snapshot.warning?.message || ''
    } catch (error) {
      state.error = getErrorMessage(error)
    } finally {
      state.busy = false
    }
  })

  return (
    <SettingsShell
      current="general"
      title="General settings"
      description="Keep everyday application behavior predictable and out of the way."
    >
      <section class="settings-control-group" aria-labelledby="window-behavior-heading">
        <header>
          <h2 id="window-behavior-heading">Window behavior</h2>
        </header>

        <div class="settings-control-row">
          <div>
            <h3>Close app when the window closes</h3>
            <p>When disabled, Jukebox keeps playing from the system tray after the window closes.</p>
          </div>
          <button
            class="settings-switch"
            type="button"
            role="switch"
            aria-checked={store.settings.closeOnX}
            aria-busy={state.busy}
            disabled={state.busy}
            data-checked={store.settings.closeOnX ? 'true' : 'false'}
            onClick$={() => saveSettings({ ...store.settings, closeOnX: !store.settings.closeOnX })}
          >
            <span aria-hidden="true" />
            <span class="sr-only">Close app when the window closes</span>
          </button>
        </div>

        {state.error && (
          <p class="settings-message" data-tone="error" role="alert">
            {state.error}
          </p>
        )}
      </section>
    </SettingsShell>
  )
})

export const head: DocumentHead = {
  title: 'General settings · Jukebox',
  meta: [{ name: 'description', content: 'Configure Jukebox application behavior.' }],
}

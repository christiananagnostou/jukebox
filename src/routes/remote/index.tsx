import { $, component$, useContext, useStore, useVisibleTask$ } from '@builder.io/qwik'
import { Link, type DocumentHead } from '@builder.io/qwik-city'
import { invoke } from '@tauri-apps/api/core'

import type { RemoteAccessStatus, TailscaleStatus } from '~/App'
import { getErrorMessage } from '~/utils/Errors'
import { StoreContext } from '../layout'

const unavailableRemoteStatus = (enabled: boolean): RemoteAccessStatus => ({
  enabled,
  error: 'Remote access status is unavailable',
  port: 45321,
  running: false,
  url: 'http://127.0.0.1:45321',
})

const unavailableTailscaleStatus = (): TailscaleStatus => ({
  connected: false,
  error: 'Tailscale status is unavailable',
  installed: false,
  serveConfigured: false,
  serveManaged: false,
})

export default component$(() => {
  const store = useContext(StoreContext)
  const state = useStore({
    remoteAccessBusy: false,
    tailscaleAction: '' as '' | 'refresh' | 'start' | 'stop',
    tailscaleActionError: '',
    remoteAccess: unavailableRemoteStatus(store.settings.remoteAccessEnabled),
    tailscale: unavailableTailscaleStatus(),
  })

  useVisibleTask$(() => {
    void Promise.all([
      invoke<RemoteAccessStatus>('get_remote_access_status').catch(() =>
        unavailableRemoteStatus(store.settings.remoteAccessEnabled)
      ),
      invoke<TailscaleStatus>('get_tailscale_status').catch(unavailableTailscaleStatus),
    ]).then(([remoteAccess, tailscale]) => {
      state.remoteAccess = remoteAccess
      state.tailscale = tailscale
    })
  })

  const toggleRemoteAccess = $(async () => {
    if (state.remoteAccessBusy) return
    state.remoteAccessBusy = true
    state.tailscaleActionError = ''
    try {
      state.remoteAccess = await invoke<RemoteAccessStatus>('set_remote_access_enabled', {
        enabled: !state.remoteAccess.enabled,
      })
      store.settings.remoteAccessEnabled = state.remoteAccess.enabled
    } catch (error) {
      state.tailscaleActionError = getErrorMessage(error)
    } finally {
      state.remoteAccessBusy = false
    }
  })

  const runTailscaleAction = $(async (action: 'refresh' | 'start' | 'stop') => {
    if (state.tailscaleAction) return
    state.tailscaleAction = action
    state.tailscaleActionError = ''
    const command =
      action === 'start' ? 'start_tailscale_serve' : action === 'stop' ? 'stop_tailscale_serve' : 'get_tailscale_status'
    try {
      state.tailscale = await invoke<TailscaleStatus>(command)
    } catch (error) {
      state.tailscaleActionError = getErrorMessage(error)
    } finally {
      state.tailscaleAction = ''
    }
  })

  const privateAccessReady = state.remoteAccess.running && state.tailscale.serveConfigured

  return (
    <section class="workspace-page remote-workspace" aria-labelledby="remote-heading">
      <header class="workspace-header">
        <div>
          <p class="workspace-eyebrow">Private access</p>
          <h1 id="remote-heading">Remote listening</h1>
          <p>Listen to this computer's Jukebox library from a phone or another device on your private network.</p>
        </div>
        <Link class="workspace-link" href="/settings/">
          All settings
        </Link>
      </header>

      <div class="remote-status-line" data-ready={privateAccessReady ? 'true' : 'false'}>
        <span aria-hidden="true" />
        <div>
          <strong>{privateAccessReady ? 'Private listening is ready' : 'Private listening is not connected'}</strong>
          <p>
            {privateAccessReady
              ? 'Open the private address on another signed-in device.'
              : 'Complete the two steps below. Jukebox never enables public Tailscale Funnel access.'}
          </p>
        </div>
      </div>

      <ol class="remote-step-list">
        <li data-complete={state.remoteAccess.running ? 'true' : 'false'}>
          <span class="remote-step-number">1</span>
          <div class="remote-step-body">
            <header>
              <div>
                <p class="workspace-eyebrow">This computer</p>
                <h2>Run the local player</h2>
                <p>Serves Jukebox only to this computer until a private HTTPS route is connected.</p>
              </div>
              <button
                class="settings-switch"
                type="button"
                role="switch"
                aria-checked={state.remoteAccess.enabled}
                aria-busy={state.remoteAccessBusy}
                disabled={state.remoteAccessBusy}
                data-checked={state.remoteAccess.enabled ? 'true' : 'false'}
                onClick$={toggleRemoteAccess}
              >
                <span aria-hidden="true" />
                <span class="sr-only">Run the local remote-listening player</span>
              </button>
            </header>

            {state.remoteAccess.enabled && (
              <div class="remote-step-detail">
                <span class="remote-state-badge" data-ready={state.remoteAccess.running ? 'true' : 'false'}>
                  {state.remoteAccess.running ? 'Local player running' : 'Local player starting'}
                </span>
                {state.remoteAccess.error && (
                  <p class="settings-message" data-tone="error" role="alert">
                    {state.remoteAccess.error}
                  </p>
                )}
              </div>
            )}
          </div>
        </li>

        <li data-complete={state.tailscale.serveConfigured ? 'true' : 'false'}>
          <span class="remote-step-number">2</span>
          <div class="remote-step-body">
            <header>
              <div>
                <p class="workspace-eyebrow">Private HTTPS</p>
                <h2>Connect with Tailscale</h2>
                <p>Jukebox uses a dedicated Serve port so existing private routes remain untouched.</p>
              </div>
              <button
                class="workspace-secondary-action"
                type="button"
                disabled={Boolean(state.tailscaleAction)}
                onClick$={() => runTailscaleAction('refresh')}
              >
                {state.tailscaleAction === 'refresh' ? 'Checking…' : 'Check status'}
              </button>
            </header>

            <div class="remote-step-detail">
              {!state.tailscale.installed ? (
                <p>
                  Install Tailscale on this computer and the listening device, then sign both into the same tailnet.
                </p>
              ) : state.tailscale.serveConfigured ? (
                <div class="remote-ready-address">
                  <span class="remote-state-badge" data-ready="true">
                    Private route active
                  </span>
                  {state.tailscale.url && <code>{state.tailscale.url}</code>}
                  <p>Open this address in Safari, then use Share → Add to Home Screen for quick access.</p>
                  {state.tailscale.serveManaged ? (
                    <button
                      class="workspace-secondary-action"
                      type="button"
                      disabled={Boolean(state.tailscaleAction)}
                      onClick$={() => runTailscaleAction('stop')}
                    >
                      {state.tailscaleAction === 'stop' ? 'Stopping…' : 'Stop private route'}
                    </button>
                  ) : (
                    <p class="settings-message" data-tone="warning">
                      This route is shared, so Jukebox will not remove it automatically.
                    </p>
                  )}
                </div>
              ) : state.tailscale.connected ? (
                state.tailscale.recommendedHttpsPort ? (
                  <div class="remote-ready-address">
                    <p>
                      A dedicated private HTTPS port is available: {state.tailscale.recommendedHttpsPort}. Existing
                      routes will not be changed.
                    </p>
                    <button
                      class="workspace-primary-action"
                      type="button"
                      disabled={Boolean(state.tailscaleAction) || !state.remoteAccess.running}
                      onClick$={() => runTailscaleAction('start')}
                    >
                      {state.tailscaleAction === 'start' ? 'Starting…' : 'Start private listening'}
                    </button>
                  </div>
                ) : (
                  <p class="settings-message" data-tone="warning">
                    No private HTTPS port is available. Stop an unused Tailscale Serve endpoint, then check again.
                  </p>
                )
              ) : (
                <div>
                  <p>Open Tailscale and sign in before connecting private HTTPS.</p>
                  {state.tailscale.backendState && <p class="remote-muted">State: {state.tailscale.backendState}</p>}
                  {state.tailscale.error && (
                    <p class="settings-message" data-tone="error">
                      {state.tailscale.error}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </li>
      </ol>

      {state.tailscaleActionError && (
        <p class="settings-message remote-action-error" data-tone="error" role="alert">
          {state.tailscaleActionError}
        </p>
      )}

      <p class="remote-privacy-note">
        The music server stays local to this computer. Tailscale Serve makes it available only to devices authorized on
        the same private network.
      </p>
    </section>
  )
})

export const head: DocumentHead = {
  title: 'Remote listening · Jukebox',
  meta: [{ name: 'description', content: 'Listen to Jukebox securely from another device.' }],
}

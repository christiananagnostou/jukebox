import type { BootstrapState, Settings, SettingsSnapshot, Song } from '~/App'

export const LIBRARY_BOOTSTRAP_ERROR_MESSAGE =
  'Jukebox could not open the library. Restart the app or check Diagnostics.'
export const SETTINGS_BOOTSTRAP_ERROR_MESSAGE =
  'Jukebox could not load settings. Defaults are active until you save them.'
export const SETTINGS_SAVE_ERROR_MESSAGE =
  'Jukebox could not save settings. Your previous settings are still available.'

export const DEFAULT_SETTINGS: Settings = {
  closeOnX: false,
  musicFolder: '',
  remoteAccessEnabled: false,
}

export interface LibraryBootstrapResult {
  error: string
  songs: Song[]
  status: 'ready' | 'error'
}

export interface SettingsBootstrapResult {
  settings: Settings
  warning: string
}

export interface BootstrapResult {
  library: LibraryBootstrapResult
  settings: SettingsBootstrapResult
}

export async function settleBootstrap(
  loadLibrary: () => Promise<Song[]>,
  loadSettings: () => Promise<SettingsSnapshot>
): Promise<BootstrapResult> {
  const [libraryResult, settingsResult] = await Promise.allSettled([loadLibrary(), loadSettings()])

  return {
    library:
      libraryResult.status === 'fulfilled'
        ? { error: '', songs: libraryResult.value, status: 'ready' }
        : { error: LIBRARY_BOOTSTRAP_ERROR_MESSAGE, songs: [], status: 'error' },
    settings:
      settingsResult.status === 'fulfilled'
        ? {
            settings: settingsResult.value.settings,
            warning: settingsResult.value.warning?.message || '',
          }
        : {
            settings: { ...DEFAULT_SETTINGS },
            warning: SETTINGS_BOOTSTRAP_ERROR_MESSAGE,
          },
  }
}

export function applyLibraryBootstrap(state: BootstrapState, result: LibraryBootstrapResult): void {
  state.libraryStatus = result.status
  state.libraryError = result.error
}

export function applySettingsBootstrap(state: BootstrapState, result: SettingsBootstrapResult): void {
  state.settingsWarning = result.warning
}

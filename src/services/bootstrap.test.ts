import { describe, expect, it } from 'vitest'

import type { BootstrapState, SettingsSnapshot, Song } from '~/App'
import {
  applyLibraryBootstrap,
  applySettingsBootstrap,
  DEFAULT_SETTINGS,
  LIBRARY_BOOTSTRAP_ERROR_MESSAGE,
  SETTINGS_BOOTSTRAP_ERROR_MESSAGE,
  settleBootstrap,
} from './bootstrap'

const song = (id: string): Song => ({
  id,
  path: `/music/${id}.flac`,
  file: `${id}.flac`,
  title: id,
  album: 'Album',
  artist: 'Artist',
  genre: '',
  bpm: 0,
  compilation: 0,
  date: '',
  encoder: '',
  trackTotal: 1,
  trackNumber: 1,
  codec: 'flac',
  duration: '0:03:00.000',
  sampleRate: '44100',
  side: 1,
  startTime: 0,
  favorRating: 0,
  dateAdded: '2026-08-26T00:00:00.000Z',
  visualsPath: '',
})

const savedSettings: SettingsSnapshot = {
  settings: {
    closeOnX: true,
    musicFolder: '/Music',
    remoteAccessEnabled: true,
  },
  warning: null,
}

describe('settleBootstrap', () => {
  it('returns both successful results', async () => {
    const songs = [song('one')]

    const result = await settleBootstrap(
      async () => songs,
      async () => savedSettings
    )

    expect(result.library).toEqual({ error: '', songs, status: 'ready' })
    expect(result.settings).toEqual({ settings: savedSettings.settings, warning: '' })
  })

  it('keeps settings when only the library fails', async () => {
    const result = await settleBootstrap(
      async () => Promise.reject(new Error('/private/library.db failed')),
      async () => savedSettings
    )

    expect(result.library).toEqual({ error: LIBRARY_BOOTSTRAP_ERROR_MESSAGE, songs: [], status: 'error' })
    expect(result.library.error).not.toContain('/private/library.db')
    expect(result.settings).toEqual({ settings: savedSettings.settings, warning: '' })
  })

  it('keeps the library when only settings loading fails', async () => {
    const songs = [song('one')]

    const result = await settleBootstrap(
      async () => songs,
      async () => Promise.reject(new Error('/private/settings.json failed'))
    )

    expect(result.library).toEqual({ error: '', songs, status: 'ready' })
    expect(result.settings).toEqual({ settings: DEFAULT_SETTINGS, warning: SETTINGS_BOOTSTRAP_ERROR_MESSAGE })
    expect(result.settings.warning).not.toContain('/private/settings.json')
  })

  it('reports both failures independently', async () => {
    const result = await settleBootstrap(
      async () => Promise.reject(new Error('database failed')),
      async () => Promise.reject(new Error('settings failed'))
    )

    expect(result.library.status).toBe('error')
    expect(result.library.error).toBe(LIBRARY_BOOTSTRAP_ERROR_MESSAGE)
    expect(result.settings.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.settings.warning).toBe(SETTINGS_BOOTSTRAP_ERROR_MESSAGE)
  })

  it('uses the fixed native warning for malformed settings', async () => {
    const warning =
      'Jukebox could not read settings because the file is invalid. Defaults are active until you save them.'

    const result = await settleBootstrap(
      async () => [],
      async () => ({
        settings: { ...DEFAULT_SETTINGS },
        warning: { code: 'invalid_json', message: warning },
      })
    )

    expect(result.settings.warning).toBe(warning)
  })
})

describe('bootstrap state updates', () => {
  it('clears only the field owned by a later successful operation', () => {
    const state: BootstrapState = {
      libraryStatus: 'error',
      libraryError: LIBRARY_BOOTSTRAP_ERROR_MESSAGE,
      settingsWarning: SETTINGS_BOOTSTRAP_ERROR_MESSAGE,
    }

    applyLibraryBootstrap(state, { error: '', songs: [], status: 'ready' })
    expect(state).toEqual({
      libraryStatus: 'ready',
      libraryError: '',
      settingsWarning: SETTINGS_BOOTSTRAP_ERROR_MESSAGE,
    })

    state.libraryStatus = 'error'
    state.libraryError = LIBRARY_BOOTSTRAP_ERROR_MESSAGE
    applySettingsBootstrap(state, { settings: { ...DEFAULT_SETTINGS }, warning: '' })
    expect(state).toEqual({
      libraryStatus: 'error',
      libraryError: LIBRARY_BOOTSTRAP_ERROR_MESSAGE,
      settingsWarning: '',
    })
  })
})

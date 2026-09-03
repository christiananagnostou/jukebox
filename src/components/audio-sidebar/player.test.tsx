import { $, component$, useContextProvider, useStore } from '@builder.io/qwik'
import { createDOM } from '@builder.io/qwik/testing'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@builder.io/qwik-city', () => ({
  Link: (props: { children?: unknown }) => props.children ?? null,
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
  invoke: vi.fn(),
}))

import type { Song, Store, StoreActions } from '~/App'
import { StoreActionsContext, StoreContext } from '~/routes/layout'
import { commitPlaybackView, createPlaybackViewState } from '~/services/playback-view'
import Player from './player'
import Queue from './queue'

function song(id: string, title: string, artist: string, album: string): Song {
  return {
    album,
    artist,
    bpm: 0,
    codec: 'flac',
    compilation: 0,
    date: '2026',
    dateAdded: '',
    duration: '0:03:00.000',
    encoder: '',
    favorRating: 0,
    file: `${id}.flac`,
    genre: '',
    id,
    path: `/music/${id}.flac`,
    sampleRate: '44100',
    side: 1,
    startTime: 0,
    title,
    trackNumber: 1,
    trackTotal: 1,
    visualsPath: '',
  }
}

const first = song('first', 'Morning At Boma Park', 'Andreas Vollenweider', 'Book Of Roses')
const firstUpcoming = song('first-upcoming', 'The Grand Ball Of The Duljas', 'Andreas Vollenweider', 'Book Of Roses')
const second = song('second', "It's In The Rain", 'Enya', 'Amarantine')
const secondUpcoming = song('second-upcoming', 'Amarantine', 'Enya', 'Amarantine')

const Harness = component$(() => {
  const store = useStore({
    libraryCatalog: { refreshKey: 0 },
    playback: {
      ...createPlaybackViewState(),
      context: [first, firstUpcoming],
      current: first,
      currentContextIndex: 0,
      source: { kind: 'album', label: 'Book Of Roses' },
      volumePercent: 37,
    },
  } as Store)
  useContextProvider(StoreContext, store)
  useContextProvider(StoreActionsContext, {
    setVolumePercent: $((volumePercent: number) => {
      store.playback.volumePercent = volumePercent
    }),
  } as StoreActions)

  const swap = $(() => {
    commitPlaybackView(store.playback, {
      ...store.playback,
      context: [second, secondUpcoming],
      current: second,
      currentContextIndex: 0,
      source: { kind: 'collection', label: 'Recently Played' },
    })
  })

  return (
    <div>
      <button id="swap-track" onClick$={swap}>
        Swap track
      </button>
      <Player />
      <Queue />
    </div>
  )
})

describe('playback drawer state', () => {
  it('updates every metadata and upcoming field when the playback view changes', async () => {
    const { render, screen, userEvent } = await createDOM()
    await render(<Harness />)

    expect(screen.querySelector('.playback-track-title')?.textContent).toBe('Morning At Boma Park')
    expect(screen.querySelector('.playback-track-artist')?.textContent).toBe('Andreas Vollenweider')
    expect(screen.querySelector('.playback-track-album')?.textContent).toBe('Book Of Roses')
    expect(screen.querySelector('.playback-upcoming-title')?.textContent).toBe('The Grand Ball Of The Duljas')

    await userEvent('#swap-track', 'click')

    expect(screen.querySelector('.playback-track-title')?.textContent).toBe("It's In The Rain")
    expect(screen.querySelector('.playback-track-artist')?.textContent).toBe('Enya')
    expect(screen.querySelector('.playback-track-album')?.textContent).toBe('Amarantine')
    expect(screen.querySelector('.playback-upcoming-title')?.textContent).toBe('Amarantine')
  })

  it('resets volume from the numeric control', async () => {
    const { render, screen, userEvent } = await createDOM()
    await render(<Harness />)

    const resetButton = screen.querySelector('[aria-label="Reset volume to 100 percent"]')
    expect(resetButton?.textContent).toBe('37')

    await userEvent(resetButton as Element, 'click')
    expect(resetButton?.textContent).toBe('100')
  })
})

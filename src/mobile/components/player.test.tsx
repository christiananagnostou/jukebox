import { component$, useContextProvider, useSignal, useStore } from '@builder.io/qwik'
import type { NoSerialize } from '@builder.io/qwik'
import { createDOM } from '@builder.io/qwik/testing'
import { describe, it, expect } from 'vitest'
import { initialLibrary, initialPlayer } from '../model'
import { MobileContext } from '../context'
import type { MobileRuntime } from '../runtime'
import { MiniPlayer, NowPlaying } from './player'
import { Library } from './library'

const Harness = component$(() => {
  const player = useStore(initialPlayer())
  const library = useStore(initialLibrary())
  const runtime = useSignal<NoSerialize<MobileRuntime>>()
  const panel = useSignal<HTMLDialogElement>()
  const handle = useSignal<HTMLElement>()
  const seek = useSignal<HTMLInputElement>()
  const queue = useSignal<HTMLDetailsElement>()
  useContextProvider(MobileContext, { player, library, runtime })
  return (
    <div>
      <button
        id="select-test-track"
        onClick$={() => {
          const track = {
            id: 'test',
            title: 'Together',
            artist: 'New artist',
            album: 'New album',
            file: 'test.mp3',
            codec: 'mp3',
            duration: '3:00',
          }
          player.active = track
          player.queue = { queue: [track], currentIndex: 0 }
          player.ready = true
          player.duration = 180
          player.position = 45
        }}
      >
        Select
      </button>
      <button
        id="error-test"
        onClick$={() => {
          player.feedback = { heading: 'Playback interrupted', message: '', actions: ['retry'] }
        }}
      >
        Error
      </button>
      <Library />
      <MiniPlayer />
      <NowPlaying panel={panel} handle={handle} seek={seek} queue={queue} />
      <audio id="stable-audio" />
    </div>
  )
})
describe('Qwik mobile rendering', () => {
  it('reactively updates metadata, artwork, queue, seek and transport without replacing the audio element', async () => {
    const { render, screen, userEvent } = await createDOM()
    await render(<Harness />)
    const audio = screen.querySelector('audio')
    expect(screen.querySelector('#view-title')?.textContent).toBe('Albums')
    await userEvent('#select-test-track', 'click')
    expect(screen.querySelector('#mini-title')?.textContent).toBe('Together')
    expect(screen.querySelector('#now-artist')?.textContent).toBe('New artist')
    expect(screen.querySelector('#now-playing-detail')?.textContent).toBe('New album')
    expect(screen.querySelector('#now-art img')?.getAttribute('src')).toBe('/api/tracks/test/artwork')
    expect(screen.querySelector('.queue-track')?.textContent).toContain('Together')
    expect(screen.querySelector('#elapsed')?.textContent).toBe('0:45')
    expect(screen.querySelector('audio')).toBe(audio)
    expect(screen.querySelector('#player-heading')?.textContent).toBe('Now playing')
    expect(screen.querySelector('#playback-actions')?.children.length).toBe(0)
    await userEvent('#error-test', 'click')
    expect(screen.querySelector('#player-heading')?.textContent).toBe('Playback interrupted')
    expect(screen.querySelector('#playback-actions')?.textContent).toBe('Retry')
  })
})

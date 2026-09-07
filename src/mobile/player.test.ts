// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerController, SESSION_KEY } from './player'
import { initialPlayer } from './model'
import type { PlayerTrack } from './model'
import {
  createPersistedSession,
  createPlayerState,
  replaceQueue,
  selectTrack,
} from '../../src-tauri/src/remote_access/player-core.js'

const tracks: PlayerTrack[] = ['one', 'two', 'three'].map((id) => ({
  id,
  title: id,
  file: `${id}.mp3`,
  artist: id,
  album: 'Together',
  duration: '3:00',
  codec: 'mp3',
}))
let audio: HTMLAudioElement, paused: boolean, controller: PlayerController
let state: ReturnType<typeof initialPlayer>
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
beforeEach(() => {
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
    clear: () => saved.clear(),
  })
  paused = true
  audio = document.createElement('audio')
  state = initialPlayer()
  Object.defineProperties(audio, { paused: { get: () => paused }, duration: { get: () => 180 } })
  audio.play = vi.fn(async () => {
    paused = false
    audio.dispatchEvent(new Event('playing'))
  })
  audio.pause = vi.fn(() => {
    paused = true
    audio.dispatchEvent(new Event('pause'))
  })
  audio.load = vi.fn()
})
afterEach(() => {
  controller?.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const start = (fetcher: typeof fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'))) =>
  (controller = new PlayerController(state, audio, localStorage, fetcher))
describe('persistent mobile audio controller', () => {
  it('starts audio synchronously and updates the full reactive snapshot', async () => {
    start()
    const playing = controller.select(tracks, 0, '1')
    expect(audio.play).toHaveBeenCalledTimes(1)
    await playing
    expect(state.active?.artist).toBe('one')
    expect(state.paused).toBe(false)
    await controller.next()
    expect(state.active?.artist).toBe('two')
    audio.currentTime = 20
    await controller.previous()
    expect(audio.currentTime).toBe(0)
    expect(state.active?.id).toBe('two')
    await controller.previous()
    expect(state.active?.id).toBe('one')
  })
  it('keeps routine pause quiet and clears exceptional feedback after playback resumes', async () => {
    start()
    await controller.select(tracks, 0, '1')
    audio.dispatchEvent(new Event('waiting'))
    expect(state.feedback.heading).toBe('Buffering…')
    audio.dispatchEvent(new Event('stalled'))
    expect(state.feedback.actions).toEqual(['retry'])
    controller.toggle()
    expect(state.feedback.heading).toBe('Now playing')
    expect(state.feedback.actions).toEqual([])
    controller.toggle()
    await settle()
    expect(state.paused).toBe(false)
  })
  it('ignores rejected play requests from a superseded track', async () => {
    start()
    let reject!: (error: Error) => void
    vi.mocked(audio.play).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        })
    )
    const first = controller.select(tracks, 0, '1')
    await controller.next()
    reject(new Error('Old playback rejected'))
    await first
    expect(state.active?.id).toBe('two')
    expect(state.feedback.heading).toBe('Now playing')
  })
  it('ignores a late unavailable probe after the track changes', async () => {
    let resolve!: (response: Response) => void
    start(
      vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    )
    await controller.select(tracks, 0, '1')
    audio.dispatchEvent(new Event('error'))
    await controller.next()
    resolve(new Response('', { status: 404 }))
    await settle()
    expect(state.active?.id).toBe('two')
    expect(state.feedback.actions).toEqual([])
  })
  it('restores the existing session format without autoplay and clears stale revisions', async () => {
    const queue = selectTrack(replaceQueue(createPlayerState(), tracks), 1)
    localStorage.setItem(SESSION_KEY, JSON.stringify(createPersistedSession(queue, '1', 45000, Date.now())))
    start()
    expect(state.active?.id).toBe('two')
    expect(audio.play).not.toHaveBeenCalled()
    audio.dispatchEvent(new Event('loadedmetadata'))
    expect(audio.currentTime).toBe(45)
    await controller.validateRevision('2')
    expect(state.active).toBeNull()
    expect(state.queue.queue).toHaveLength(0)
  })
  it('preserves queue occurrences and disposes media listeners', async () => {
    start()
    await controller.select([tracks[0], tracks[0], tracks[1]], 1, '1')
    controller.remove(0)
    expect(state.queue.currentIndex).toBe(0)
    expect(state.active?.id).toBe('one')
    controller.remove(0)
    expect(state.active).toBeNull()
    controller.dispose()
    const heading = state.feedback.heading
    audio.dispatchEvent(new Event('waiting'))
    expect(state.feedback.heading).toBe(heading)
    expect(state.ready).toBe(false)
  })
})

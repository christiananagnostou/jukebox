import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import { NativePlaybackBridge, type PlaybackSnapshot } from './playback-client'

function snapshot(revision: number): PlaybackSnapshot {
  return {
    context: { cursor: 0, order: [0], trackIds: ['track-one'] },
    current: {
      contextIndex: 0,
      queueEntryId: null,
      resumeContextIndex: null,
      trackId: 'track-one',
    },
    durationMs: 0,
    error: null,
    history: [],
    muted: false,
    positionMs: 0,
    queue: [],
    repeatMode: 'off',
    revision,
    schemaVersion: 1,
    shuffle: { enabled: false, seed: 1 },
    status: 'playing',
    transitionPending: false,
    volumePercent: 100,
  }
}

describe('NativePlaybackBridge', () => {
  beforeEach(() => invokeMock.mockReset())

  it('serializes concurrent commands onto the latest accepted revision', async () => {
    invokeMock.mockResolvedValueOnce(snapshot(5)).mockResolvedValueOnce(snapshot(6)).mockResolvedValueOnce(snapshot(7))
    const bridge = new NativePlaybackBridge()

    const first = bridge.dispatch({ type: 'pause' })
    const second = bridge.dispatch({ type: 'play' })
    await Promise.all([first, second])

    expect(invokeMock).toHaveBeenNthCalledWith(2, 'dispatch_playback_command', {
      request: { command: { type: 'pause' }, expectedRevision: 5 },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'dispatch_playback_command', {
      request: { command: { type: 'play' }, expectedRevision: 6 },
    })
  })

  it('reloads once after a typed stale revision before retrying', async () => {
    invokeMock
      .mockResolvedValueOnce(snapshot(1))
      .mockRejectedValueOnce({ code: 'stale_revision', currentRevision: 4 })
      .mockResolvedValueOnce(snapshot(4))
      .mockResolvedValueOnce(snapshot(5))
    const bridge = new NativePlaybackBridge()

    await bridge.dispatch({ type: 'pause' })

    expect(invokeMock).toHaveBeenNthCalledWith(4, 'dispatch_playback_command', {
      request: { command: { type: 'pause' }, expectedRevision: 4 },
    })
    expect(invokeMock).toHaveBeenCalledTimes(4)
  })

  it('carries a compact position revision into the next serialized command', async () => {
    invokeMock
      .mockResolvedValueOnce(snapshot(2))
      .mockResolvedValueOnce({ durationMs: 180_000, positionMs: 12_000, revision: 3 })
      .mockResolvedValueOnce(snapshot(4))
    const bridge = new NativePlaybackBridge()

    await bridge.observePosition('track-one', 12_000, 180_000)
    await bridge.dispatch({ type: 'pause' })

    expect(invokeMock).toHaveBeenNthCalledWith(2, 'observe_playback_position', {
      observation: {
        durationMs: 180_000,
        expectedRevision: 2,
        positionMs: 12_000,
        trackId: 'track-one',
      },
    })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'dispatch_playback_command', {
      request: { command: { type: 'pause' }, expectedRevision: 3 },
    })
  })
})

import { invoke } from '@tauri-apps/api/core'

export type PlaybackErrorCode = 'decoder' | 'output' | 'unavailable' | 'unknown'
export type PlaybackStatus = 'stopped' | 'paused' | 'playing'

export interface NativeQueueEntry {
  entryId: string
  trackId: string
}

export interface PlaybackSelection {
  contextIndex?: number | null
  queueEntryId?: string | null
  resumeContextIndex?: number | null
  trackId: string
}

export interface PlaybackSnapshot {
  canUndoQueueEdit: boolean
  context: {
    cursor?: number | null
    order: number[]
    trackIds: string[]
  }
  current?: PlaybackSelection | null
  durationMs: number
  error?: { code: PlaybackErrorCode; recoverable: boolean } | null
  history: PlaybackSelection[]
  muted: boolean
  persistenceWarning: boolean
  positionMs: number
  queue: NativeQueueEntry[]
  repeatMode: 'off' | 'one' | 'all'
  revision: number
  schemaVersion: number
  shuffle: { enabled: boolean; seed: number }
  status: PlaybackStatus
  transitionPending: boolean
  volumePercent: number
}

export type PlaybackCommand =
  | { type: 'replaceContext'; autoplay: boolean; startIndex: number; trackIds: string[] }
  | { type: 'enqueue'; entries: NativeQueueEntry[] }
  | { type: 'removeQueueEntry'; entryId: string }
  | { type: 'moveQueueEntry'; beforeEntryId?: string | null; entryId: string }
  | { type: 'clearUpcoming' }
  | { type: 'undoQueueEdit' }
  | { type: 'discardQueueUndo' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; positionMs: number }
  | { type: 'updateDuration'; durationMs: number }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'ended' }
  | { type: 'setRepeat'; repeatMode: 'off' | 'one' | 'all' }
  | { type: 'setShuffle'; enabled: boolean; seed: number }
  | { type: 'markUnavailable'; trackId: string }
  | { type: 'reportError'; code: PlaybackErrorCode; recoverable: boolean }
  | { type: 'commitTransition' }
  | { type: 'rejectTransition'; code: PlaybackErrorCode; recoverable: boolean }
  | { type: 'clearError' }
  | { type: 'setVolume'; muted: boolean; volumePercent: number }

export interface PlaybackPositionState {
  durationMs: number
  positionMs: number
  revision: number
}

export interface PlaybackBridge {
  dispatch(command: PlaybackCommand): Promise<PlaybackSnapshot>
  getSnapshot(): Promise<PlaybackSnapshot>
  observePosition(trackId: string, positionMs: number, durationMs: number): Promise<PlaybackPositionState>
}

interface PlaybackCommandError {
  code?: string
}

function isStaleRevision(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as PlaybackCommandError).code === 'stale_revision'
}

export class NativePlaybackBridge implements PlaybackBridge {
  private latest?: PlaybackSnapshot
  private tail: Promise<void> = Promise.resolve()

  getSnapshot(): Promise<PlaybackSnapshot> {
    return this.serialize(async () => this.reload())
  }

  dispatch(command: PlaybackCommand): Promise<PlaybackSnapshot> {
    return this.serialize(async () => {
      const snapshot = this.latest || (await this.reload())
      try {
        return await this.invokeCommand(command, snapshot.revision)
      } catch (error) {
        if (!isStaleRevision(error)) throw error
        const reloaded = await this.reload()
        return this.invokeCommand(command, reloaded.revision)
      }
    })
  }

  observePosition(trackId: string, positionMs: number, durationMs: number): Promise<PlaybackPositionState> {
    return this.serialize(async () => {
      const snapshot = this.latest || (await this.reload())
      try {
        return await this.invokePosition(trackId, positionMs, durationMs, snapshot.revision)
      } catch (error) {
        if (!isStaleRevision(error)) throw error
        const reloaded = await this.reload()
        return this.invokePosition(trackId, positionMs, durationMs, reloaded.revision)
      }
    })
  }

  private async invokeCommand(command: PlaybackCommand, expectedRevision: number): Promise<PlaybackSnapshot> {
    const snapshot = await invoke<PlaybackSnapshot>('dispatch_playback_command', {
      request: { command, expectedRevision },
    })
    this.acceptSnapshot(snapshot)
    return snapshot
  }

  private async invokePosition(
    trackId: string,
    positionMs: number,
    durationMs: number,
    expectedRevision: number
  ): Promise<PlaybackPositionState> {
    const position = await invoke<PlaybackPositionState>('observe_playback_position', {
      observation: { durationMs, expectedRevision, positionMs, trackId },
    })
    if (this.latest && position.revision >= this.latest.revision) {
      this.latest = {
        ...this.latest,
        durationMs: position.durationMs,
        positionMs: position.positionMs,
        revision: position.revision,
      }
    }
    return position
  }

  private async reload(): Promise<PlaybackSnapshot> {
    const snapshot = await invoke<PlaybackSnapshot>('get_playback_snapshot')
    this.acceptSnapshot(snapshot)
    return this.latest || snapshot
  }

  private acceptSnapshot(snapshot: PlaybackSnapshot): void {
    if (!this.latest || snapshot.revision >= this.latest.revision) this.latest = snapshot
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

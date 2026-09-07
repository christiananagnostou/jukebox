import {
  clampSeekTarget,
  clearPersistedSession,
  clearQueue,
  createPersistedSession,
  currentTrack,
  endTrack,
  loadPersistedSession,
  mediaSessionPositionState,
  nextTrack,
  previousTrack,
  removeQueueOccurrence,
  replaceQueue,
  savePersistedSession,
  selectTrack,
} from '../../src-tauri/src/remote_access/player-core.js'
import { AUDIO_CACHE, saveOfflineTrack } from '../../src-tauri/src/remote_access/data-cache.js'
import { streamUrl, trackArtwork } from './model'
import type { PlayerModel, PlayerTrack, Recovery } from './model'

export const SESSION_KEY = 'jukebox.private-player.session'
/** One stable HTMLAudioElement for the whole PWA lifetime. UI navigation never owns transport. */
export class PlayerController {
  private cleanups: (() => void)[] = []
  private epoch = 0
  private endedHandled = false
  private failed = false
  private restored = false
  private checkpointBucket = -1
  private positionBucket = -1
  private resumePosition = 0
  private destroyed = false
  private downloadPending = false
  constructor(
    readonly state: PlayerModel,
    readonly audio: HTMLAudioElement,
    private storage: Storage | null,
    private fetcher: typeof fetch = fetch
  ) {
    this.listen(audio, 'playing', () => {
      this.failed = false
      this.endedHandled = false
      this.feedback()
      this.sync()
      this.mediaState()
    })
    this.listen(audio, 'pause', () => {
      this.sync()
      this.checkpoint()
      this.mediaState()
      if (!this.failed && !audio.ended) this.feedback()
    })
    this.listen(audio, 'waiting', () => {
      if (state.active && !audio.paused) this.feedback('Buffering…')
    })
    this.listen(audio, 'stalled', () => {
      if (state.active && !audio.paused) this.feedback('Reconnecting…', '', ['retry'])
    })
    this.listen(audio, 'error', () => {
      this.failed = true
      if (state.active) void this.classifyFailure(state.active, this.epoch)
    })
    this.listen(audio, 'ended', () => {
      if (this.endedHandled || !audio.ended) return
      this.endedHandled = true
      const next = endTrack(state.queue)
      if (next === state.queue || next.currentIndex === null) this.feedback('End of queue')
      else void this.playAt(next.currentIndex)
    })
    this.listen(audio, 'loadedmetadata', () => {
      if (this.resumePosition) {
        this.seek(this.resumePosition)
        this.resumePosition = 0
      }
      this.sync()
      this.mediaPosition()
    })
    this.listen(audio, 'durationchange', () => {
      this.sync()
      this.mediaPosition()
    })
    this.listen(audio, 'timeupdate', () => {
      this.sync()
      const bucket = Math.floor(audio.currentTime / 5)
      if (bucket !== this.checkpointBucket) {
        this.checkpointBucket = bucket
        this.checkpoint()
      }
      const second = Math.floor(audio.currentTime)
      if (second !== this.positionBucket) {
        this.positionBucket = second
        this.mediaPosition()
      }
    })
    this.listen(window, 'pagehide', () => this.checkpoint())
    this.listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.checkpoint()
    })
    this.installMediaSession()
    this.restore()
    state.ready = true
    this.sync()
  }
  private listen(target: EventTarget, name: string, handler: EventListener) {
    target.addEventListener(name, handler)
    this.cleanups.push(() => target.removeEventListener(name, handler))
  }
  feedback(heading = 'Now playing', message = '', actions: Recovery[] = []) {
    if (!this.destroyed) this.state.feedback = { heading, message, actions }
  }
  private sync() {
    const s = this.state
    s.paused = this.audio.paused
    s.position = s.active && Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0
    s.duration = s.active && Number.isFinite(this.audio.duration) ? this.audio.duration : 0
  }
  private source(track: PlayerTrack, position = 0) {
    ++this.epoch
    this.failed = false
    this.endedHandled = false
    this.checkpointBucket = -1
    this.positionBucket = -1
    this.resumePosition = position
    this.state.active = track
    this.state.position = 0
    this.state.duration = 0
    this.audio.src = streamUrl(track)
    this.feedback()
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || track.file,
          artist: track.artist,
          album: track.album,
          artwork: [{ src: new URL(trackArtwork(track), window.location.origin).href }],
        })
      } catch {
        /* Optional media capability. */
      }
    }
    void this.updateOffline()
  }
  /** Call synchronously from the native gesture bridge; never await network before audio.play(). */
  async play(): Promise<boolean> {
    if (!this.state.active || this.destroyed) return false
    const epoch = this.epoch
    try {
      await this.audio.play()
      return epoch === this.epoch
    } catch {
      if (epoch === this.epoch && !this.destroyed) {
        this.failed = true
        this.feedback('Ready to play', 'Tap the play control to start audio.')
      }
      return false
    } finally {
      if (epoch === this.epoch && !this.destroyed) this.sync()
    }
  }
  toggle() {
    if (this.audio.paused) void this.play()
    else this.audio.pause()
  }
  select(tracks: PlayerTrack[], index: number, revision: string) {
    this.restored = false
    this.state.queue = replaceQueue(this.state.queue, tracks)
    this.state.revision = revision
    return this.playAt(index)
  }
  playAt(index: number): Promise<boolean> {
    const selected = selectTrack(this.state.queue, index)
    if (selected.currentIndex !== index) return Promise.resolve(false)
    this.state.queue = selected
    const track = currentTrack(selected)
    if (!track) return Promise.resolve(false)
    this.source(track)
    this.checkpoint()
    return this.play()
  }
  next() {
    const next = nextTrack(this.state.queue)
    if (next !== this.state.queue && next.currentIndex !== null) return this.playAt(next.currentIndex)
    return Promise.resolve(false)
  }
  previous() {
    if (this.audio.currentTime > 3 || this.state.queue.currentIndex === 0) {
      this.seek(0)
      return this.play()
    }
    const previous = previousTrack(this.state.queue)
    if (previous !== this.state.queue && previous.currentIndex !== null) return this.playAt(previous.currentIndex)
    return Promise.resolve(false)
  }
  seek(position: number) {
    const target = clampSeekTarget(position, this.audio.duration)
    if (target === null) return
    try {
      this.audio.currentTime = target
      this.sync()
      this.mediaPosition()
      this.checkpoint()
    } catch {
      /* Metadata not ready yet. */
    }
  }
  retry() {
    if (this.state.active) {
      this.audio.load()
      return this.play()
    }
    return Promise.resolve(false)
  }
  recover(action: Recovery) {
    if (action === 'retry') return this.retry()
    if (action === 'skip') return this.next()
    if (this.state.queue.currentIndex !== null) this.remove(this.state.queue.currentIndex)
  }
  remove(index: number) {
    const removing = index === this.state.queue.currentIndex
    this.state.queue = removeQueueOccurrence(this.state.queue, index)
    if (removing) {
      this.stop()
      this.feedback('Choose a song')
    }
    this.checkpoint()
  }
  clear() {
    this.state.queue = clearQueue(this.state.queue)
    this.state.revision = ''
    this.restored = false
    this.stop()
    this.feedback('Queue empty')
    if (this.storage) clearPersistedSession(this.storage, SESSION_KEY)
  }
  private stop() {
    ++this.epoch
    this.resumePosition = 0
    this.failed = false
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.state.active = null
    this.sync()
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null
  }
  checkpoint() {
    const s = this.state
    if (!this.storage) return
    if (!s.queue.queue.length || !s.revision) {
      clearPersistedSession(this.storage, SESSION_KEY)
      return
    }
    const position =
      s.queue.currentIndex === null
        ? 0
        : Math.max(0, Math.round((this.resumePosition || this.audio.currentTime || 0) * 1000))
    const session = createPersistedSession(s.queue, s.revision, position, Date.now())
    if (session) savePersistedSession(this.storage, SESSION_KEY, session)
  }
  private restore() {
    if (!this.storage) return
    const session = loadPersistedSession(this.storage, SESSION_KEY, null)
    if (!session) return
    this.state.queue = { queue: session.queue, currentIndex: session.currentIndex }
    this.state.revision = session.catalogRevision
    this.restored = true
    const track = currentTrack(this.state.queue)
    if (track) this.source(track, session.positionMilliseconds / 1000)
  }
  async validateRevision(revision: string) {
    if (!this.restored) return
    this.restored = false
    if (revision !== this.state.revision) {
      this.clear()
      this.feedback('Library updated', 'The saved queue was cleared because the library changed.')
      return
    }
    const track = this.state.active
    if (!track) return
    const epoch = this.epoch
    const availability = await this.probe(track)
    if (epoch !== this.epoch || this.destroyed) return
    if (availability === 'unavailable') {
      this.remove(this.state.queue.currentIndex!)
      this.feedback('Saved track unavailable')
    } else if (availability === 'network')
      this.feedback('Saved queue restored', 'The saved track did not respond. Retry when connected.', ['retry'])
  }
  private async probe(track: PlayerTrack) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await this.fetcher(streamUrl(track), {
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
        signal: controller.signal,
      })
      return response.status === 404 ? 'unavailable' : response.ok ? 'available' : 'network'
    } catch {
      return 'network'
    } finally {
      clearTimeout(timer)
    }
  }
  private async classifyFailure(track: PlayerTrack, epoch: number) {
    const availability = await this.probe(track)
    if (this.destroyed || epoch !== this.epoch) return
    this.feedback(
      availability === 'unavailable' ? 'Track unavailable' : navigator.onLine ? 'Playback interrupted' : 'Offline',
      '',
      availability === 'unavailable' ? ['skip', 'remove'] : ['retry']
    )
  }
  async updateOffline() {
    const track = this.state.active
    if (!track || this.downloadPending) return
    const epoch = this.epoch
    try {
      const saved = await (await caches.open(AUDIO_CACHE)).match(streamUrl(track))
      if (epoch === this.epoch && !this.destroyed) this.state.offline = saved ? 'saved' : 'available'
    } catch {
      if (epoch === this.epoch && !this.destroyed) this.state.offline = 'unavailable'
    }
  }
  async toggleOffline() {
    const track = this.state.active
    if (!track || this.downloadPending) return
    this.downloadPending = true
    this.state.offline = 'saving'
    const epoch = this.epoch
    try {
      const cache = await caches.open(AUDIO_CACHE)
      const url = streamUrl(track)
      if (await cache.match(url)) {
        await cache.delete(url)
        if (epoch === this.epoch) this.feedback('Offline copy removed')
      } else {
        await saveOfflineTrack(cache, url, this.fetcher)
        if (epoch === this.epoch)
          this.feedback('Saved offline', 'Your five most recently saved songs stay available offline.')
      }
    } catch (error) {
      if (epoch === this.epoch)
        this.feedback(
          'Could not save offline',
          error instanceof Error ? error.message : 'Free some storage and try again.'
        )
    } finally {
      this.downloadPending = false
      await this.updateOffline()
    }
  }
  private mediaState() {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing'
      } catch {
        /* Optional capability. */
      }
    }
  }
  private mediaPosition() {
    const position = mediaSessionPositionState(this.audio.duration, this.audio.currentTime, this.audio.playbackRate)
    if (position && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.setPositionState?.(position)
      } catch {
        /* Optional capability. */
      }
    }
  }
  private installMediaSession() {
    if (!('mediaSession' in navigator)) return
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => {
        void this.play()
      },
      pause: () => this.audio.pause(),
      nexttrack: () => {
        void this.next()
      },
      previoustrack: () => {
        void this.previous()
      },
      seekto: ({ seekTime }) => {
        if (seekTime !== undefined) this.seek(seekTime)
      },
      seekbackward: ({ seekOffset = 10 }) => this.seek(this.audio.currentTime - seekOffset),
      seekforward: ({ seekOffset = 10 }) => this.seek(this.audio.currentTime + seekOffset),
    }
    for (const [name, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(name as MediaSessionAction, handler)
        this.cleanups.push(() => {
          try {
            navigator.mediaSession.setActionHandler(name as MediaSessionAction, null)
          } catch {
            /* Optional capability. */
          }
        })
      } catch {
        /* Unsupported action on older WebKit. */
      }
    }
  }
  dispose() {
    this.checkpoint()
    this.destroyed = true
    ++this.epoch
    this.cleanups.forEach((cleanup) => cleanup())
    this.cleanups = []
    this.audio.pause()
    this.state.ready = false
  }
}

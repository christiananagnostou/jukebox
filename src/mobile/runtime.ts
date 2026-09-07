import { LibraryController } from './library'
import { PlayerController } from './player'
import { scrollBehavior, createPlayerSheet } from '../../src-tauri/src/remote_access/player-sheet.js'
import type { LibraryModel, PlayerModel, Recovery, View } from './model'

export interface MobileElements {
  root: HTMLElement
  audio: HTMLAudioElement
  panel: HTMLDialogElement
  handle: HTMLElement
  seek: HTMLInputElement
  queue: HTMLDetailsElement
}
/** The only synchronous DOM bridge: audio gestures, pointer capture and native dialog motion. */
export class MobileRuntime {
  readonly player: PlayerController
  readonly library: LibraryController
  readonly sheet
  private abort = new AbortController()
  constructor(
    readonly elements: MobileElements,
    playerState: PlayerModel,
    libraryState: LibraryModel
  ) {
    let storage: Storage | null = null
    try {
      storage = window.localStorage
    } catch {
      /* Private browsing may deny storage. */
    }
    this.player = new PlayerController(playerState, elements.audio, storage)
    this.library = new LibraryController(libraryState, fetch, (revision) => {
      void this.player.validateRevision(revision)
    })
    this.sheet = createPlayerSheet(elements.panel, elements.handle)
    const options = { signal: this.abort.signal }
    elements.root.addEventListener(
      'click',
      (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>('button[data-player-action]')
        if (!button || button.disabled || !elements.root.contains(button)) return
        const index = Number(button.dataset.index)
        switch (button.dataset.playerAction) {
          case 'toggle':
            this.player.toggle()
            break
          case 'next':
            void this.player.next()
            break
          case 'previous':
            void this.player.previous()
            break
          case 'track':
            void this.player.select(libraryState.tracks, index, libraryState.revision)
            break
          case 'queue':
            void this.player.playAt(index)
            break
          case 'recover':
            void this.player.recover(button.dataset.recovery as Recovery)
            break
        }
      },
      options
    )
    const seek = elements.seek
    const preview = (value: number) => {
      playerState.scrubbing = true
      playerState.preview = Math.max(0, Math.min(100, value))
    }
    const pointer = (event: PointerEvent) => {
      const rect = seek.getBoundingClientRect()
      if (rect.width) preview(((event.clientX - rect.left) / rect.width) * 100)
    }
    const cancel = () => {
      playerState.scrubbing = false
    }
    const commit = () => {
      this.player.seek((playerState.preview / 100) * playerState.duration)
      cancel()
    }
    seek.addEventListener(
      'pointerdown',
      (event) => {
        if (seek.disabled || event.button !== 0) return
        event.preventDefault()
        seek.focus({ preventScroll: true })
        seek.setPointerCapture(event.pointerId)
        pointer(event)
      },
      options
    )
    seek.addEventListener(
      'pointermove',
      (event) => {
        if (seek.hasPointerCapture(event.pointerId)) pointer(event)
      },
      options
    )
    seek.addEventListener(
      'pointerup',
      (event) => {
        if (!seek.hasPointerCapture(event.pointerId)) return
        pointer(event)
        seek.releasePointerCapture(event.pointerId)
        commit()
      },
      options
    )
    seek.addEventListener('input', () => preview(Number(seek.value)), options)
    seek.addEventListener('change', commit, options)
    seek.addEventListener('pointercancel', cancel, options)
    seek.addEventListener('blur', cancel, options)
    window.addEventListener(
      'offline',
      () => {
        this.library.invalidate()
        this.player.feedback(
          'Offline',
          'Saved songs are available on this device.',
          playerState.active ? ['retry'] : []
        )
      },
      options
    )
    window.addEventListener(
      'online',
      () => {
        this.library.invalidate()
        this.player.feedback('Back online', '', playerState.active && elements.audio.paused ? ['retry'] : [])
      },
      options
    )
    void this.library.load()
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js', { type: 'module' }).catch(() => {
        this.player.feedback('Offline mode unavailable', 'Reconnect and reload to enable offline access.')
      })
  }
  navigate(view: View, artist = '', album = '') {
    void this.sheet.close()
    window.scrollTo({ top: 0, behavior: scrollBehavior() })
    return this.library.navigate(view, artist, album)
  }
  search() {
    window.scrollTo({ top: 0, behavior: scrollBehavior() })
    return this.library.load()
  }
  back() {
    window.scrollTo({ top: 0, behavior: scrollBehavior() })
    return this.library.back()
  }
  showQueue() {
    this.elements.queue.open = true
    this.elements.queue.querySelector('summary')?.focus({ preventScroll: true })
    this.elements.queue.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
  }
  dispose() {
    this.abort.abort()
    this.library.dispose()
    this.player.dispose()
    this.sheet.dispose()
  }
}

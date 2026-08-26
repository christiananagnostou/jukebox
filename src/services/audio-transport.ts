export type AudioTransportEvent = 'durationchange' | 'ended' | 'error' | 'pause' | 'play' | 'timeupdate'

export interface AudioTransport {
  currentTime: number
  readonly duration: number
  readonly loadedSongId?: string
  clear(): void
  load(source: string, songId: string): void
  pause(): void
  play(): Promise<void>
  subscribe(event: AudioTransportEvent, listener: () => void): () => void
}

export class BrowserAudioTransport implements AudioTransport {
  constructor(private readonly element: HTMLAudioElement) {}

  get currentTime(): number {
    return this.element.currentTime
  }

  set currentTime(value: number) {
    this.element.currentTime = value
  }

  get duration(): number {
    return this.element.duration
  }

  get loadedSongId(): string | undefined {
    return this.element.dataset.loadedSongId
  }

  load(source: string, songId: string): void {
    this.element.src = source
    this.element.dataset.loadedSongId = songId
    this.element.load()
  }

  play(): Promise<void> {
    return this.element.play()
  }

  pause(): void {
    this.element.pause()
  }

  subscribe(event: AudioTransportEvent, listener: () => void): () => void {
    this.element.addEventListener(event, listener)
    return () => this.element.removeEventListener(event, listener)
  }

  clear(): void {
    this.pause()
    this.element.removeAttribute('src')
    delete this.element.dataset.loadedSongId
    this.element.load()
  }
}

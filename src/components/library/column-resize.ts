import { columnWidth, SONG_COLUMNS, type SongColumnId } from './columns'

/** Synchronous pointer capture and CSS-only drag previews; persist once on release. */
export function bindColumnResize(root: HTMLElement, commit: (id: SongColumnId, width: number) => void): () => void {
  let drag:
    { id: SongColumnId; target: HTMLElement; pointer: number; start: number; width: number; next: number } | undefined
  const down = (event: PointerEvent) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-column-resize]')
    const column = SONG_COLUMNS.find((column) => column.id === target?.dataset.columnResize)
    if (!target || !column || event.button !== 0 || drag) return
    event.preventDefault()
    const width = Number.parseFloat(root.style.getPropertyValue(`--song-${column.id}-width`)) || column.width
    drag = { id: column.id, target, pointer: event.pointerId, start: event.clientX, width, next: width }
    target.focus()
    target.setPointerCapture(event.pointerId)
    root.dataset.resizing = 'true'
  }
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return
    drag.next = columnWidth(drag.id, drag.width + event.clientX - drag.start)
    root.style.setProperty(`--song-${drag.id}-width`, `${drag.next}px`)
    drag.target.setAttribute('aria-valuenow', String(drag.next))
  }
  const finish = (event?: PointerEvent) => {
    if (!drag || (event && event.pointerId !== drag.pointer)) return
    const current = drag
    drag = undefined
    const width = event?.type === 'pointerup' ? current.next : current.width
    root.style.setProperty(`--song-${current.id}-width`, `${width}px`)
    current.target.setAttribute('aria-valuenow', String(width))
    delete root.dataset.resizing
    if (current.target.hasPointerCapture(current.pointer)) current.target.releasePointerCapture(current.pointer)
    if (event?.type === 'pointerup') commit(current.id, width)
  }
  const keydown = (event: KeyboardEvent) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-column-resize]')
    const column = SONG_COLUMNS.find((column) => column.id === target?.dataset.columnResize)
    if (!target || !column) return
    event.stopPropagation()
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    const previous = Number.parseFloat(root.style.getPropertyValue(`--song-${column.id}-width`)) || column.width
    const width =
      event.key === 'Home'
        ? column.width
        : columnWidth(column.id, previous + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10))
    root.style.setProperty(`--song-${column.id}-width`, `${width}px`)
    target.setAttribute('aria-valuenow', String(width))
    commit(column.id, width)
  }
  const reset = (event: MouseEvent) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-column-resize]')
    const column = SONG_COLUMNS.find((column) => column.id === target?.dataset.columnResize)
    if (!target || !column) return
    root.style.setProperty(`--song-${column.id}-width`, `${column.width}px`)
    target.setAttribute('aria-valuenow', String(column.width))
    commit(column.id, column.width)
  }
  root.addEventListener('keydown', keydown)
  root.addEventListener('dblclick', reset)
  root.addEventListener('pointerdown', down)
  root.addEventListener('pointermove', move)
  root.addEventListener('pointerup', finish)
  root.addEventListener('pointercancel', finish)
  root.addEventListener('lostpointercapture', finish)
  return () => {
    finish()
    root.removeEventListener('keydown', keydown)
    root.removeEventListener('dblclick', reset)
    root.removeEventListener('pointerdown', down)
    root.removeEventListener('pointermove', move)
    root.removeEventListener('pointerup', finish)
    root.removeEventListener('pointercancel', finish)
    root.removeEventListener('lostpointercapture', finish)
  }
}

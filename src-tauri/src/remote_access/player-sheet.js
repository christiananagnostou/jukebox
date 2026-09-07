export const scrollBehavior = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'

const DRAG_SLOP = 10
const VELOCITY_WINDOW = 100
const MOMENTUM_WINDOW = 180
const CLOSE_VELOCITY = 0.8
const CLOSE_RATIO = 0.4
const clamp = (value, max = 1) => Math.max(0, Math.min(max, value))

/** Retain the native modal through exit; animate only its surface and scrim. */
export const createPlayerSheet = (panel, handle) => {
  const surface = panel.querySelector('[data-sheet-surface]')
  const scrim = panel.querySelector('[data-sheet-overlay]')
  const content = panel.querySelector('.player-screen')
  const listeners = new AbortController()
  let animations = []
  let serial = 0
  let drag = null
  let phase = 'closed'
  let transition = Promise.resolve()
  let opener = null
  let unlock = null
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const height = () => Math.max(1, surface.getBoundingClientRect().height)
  const offset = () => {
    const transform = getComputedStyle(surface).transform
    if (!transform || transform === 'none') return 0
    return new DOMMatrixReadOnly(transform).m42
  }
  const cancelMotion = () => {
    animations.forEach((animation) => animation.cancel())
    animations = []
  }
  const clearStyles = () => {
    surface.style.removeProperty('transform')
    surface.style.removeProperty('opacity')
    scrim.style.removeProperty('opacity')
  }
  const clearDrag = () => {
    const previous = drag
    drag = null
    if (previous && handle.hasPointerCapture?.(previous.id)) handle.releasePointerCapture(previous.id)
    handle.removeAttribute('data-dragging')
  }
  const lockPage = () => {
    const body = document.body
    const x = window.scrollX,
      y = window.scrollY
    const keys = ['position', 'top', 'left', 'right', 'width', 'overflow']
    const saved = keys.map((key) => [key, body.style.getPropertyValue(key), body.style.getPropertyPriority(key)])
    Object.assign(body.style, {
      position: 'fixed',
      top: `${-y}px`,
      left: `${-x}px`,
      right: '0',
      width: '100%',
      overflow: 'hidden',
    })
    unlock = () => {
      for (const [key, value, priority] of saved) {
        if (value) body.style.setProperty(key, value, priority)
        else body.style.removeProperty(key)
      }
      window.scrollTo({ left: x, top: y, behavior: 'instant' })
      unlock = null
    }
  }
  const finishClose = () => {
    phase = 'closed'
    clearDrag()
    cancelMotion()
    clearStyles()
    surface.inert = false
    if (panel.open) panel.close()
    unlock?.()
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    opener = null
  }
  const settle = (from, to, closing) => {
    const token = ++serial
    const styles = getComputedStyle(panel)
    const fade = reduced()
    const opacity = Number.parseFloat(getComputedStyle(scrim).opacity)
    cancelMotion()
    clearStyles()
    phase = closing ? 'closing' : 'opening'
    surface.inert = closing
    const duration =
      Number.parseFloat(
        styles.getPropertyValue(fade ? '--sheet-reduced-ms' : closing ? '--sheet-exit-ms' : '--sheet-enter-ms')
      ) || 0
    const motion = { duration, easing: styles.getPropertyValue('--sheet-easing').trim() || 'ease-out', fill: 'both' }
    if (duration && surface.animate) {
      animations = [
        surface.animate(
          fade
            ? [{ opacity: Number.isFinite(opacity) ? opacity : closing ? 1 : 0 }, { opacity: closing ? 0 : 1 }]
            : [{ transform: `translate3d(0, ${from}px, 0)` }, { transform: `translate3d(0, ${to}px, 0)` }],
          motion
        ),
        scrim.animate(
          [{ opacity: Number.isFinite(opacity) ? opacity : clamp(1 - from / height()) }, { opacity: closing ? 0 : 1 }],
          motion
        ),
      ]
    }
    transition = Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
      if (token !== serial) return
      if (closing) finishClose()
      else {
        phase = 'open'
        cancelMotion()
        clearStyles()
      }
    })
    return transition
  }
  const open = (trigger = document.activeElement) => {
    if (phase === 'disposed') return Promise.resolve()
    if (phase === 'open' || phase === 'opening') return transition
    let from = offset()
    if (!panel.open) {
      opener = trigger
      lockPage()
      panel.showModal()
      content.scrollTop = 0
      from = height()
      scrim.style.opacity = '0'
      panel.querySelector('#player-heading')?.focus({ preventScroll: true })
    }
    clearDrag()
    return settle(from, 0, false)
  }
  const close = () => {
    if (!panel.open || phase === 'disposed') return Promise.resolve()
    if (phase === 'closing') return transition
    const from = offset()
    clearDrag()
    return settle(from, height(), true)
  }
  const listen = (target, name, callback) => target.addEventListener(name, callback, { signal: listeners.signal })
  listen(panel, 'cancel', (event) => {
    event.preventDefault()
    void close()
  })
  listen(scrim, 'click', () => {
    void close()
  })
  listen(panel, 'close', () => {
    if (!panel.open && phase !== 'closed' && phase !== 'disposed') {
      ++serial
      finishClose()
    }
  })
  listen(handle, 'pointerdown', (event) => {
    if (drag || phase === 'closing' || !panel.open || event.isPrimary === false || event.button !== 0) return
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      samples: [{ y: event.clientY, time: event.timeStamp }],
      active: false,
      from: 0,
      distance: 0,
      height: 1,
    }
    handle.setPointerCapture?.(event.pointerId)
  })
  const sample = (event) => {
    drag.samples.push({ y: event.clientY, time: event.timeStamp })
    while (drag.samples.length > 1 && drag.samples[0].time < event.timeStamp - VELOCITY_WINDOW) drag.samples.shift()
  }
  const position = (y) => {
    drag.distance = clamp(drag.from + y - drag.y, drag.height)
    surface.style.transform = `translate3d(0, ${drag.distance}px, 0)`
    scrim.style.opacity = String(clamp(1 - drag.distance / drag.height))
  }
  listen(handle, 'pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y
    if (!drag.active) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_SLOP) return
      if (Math.abs(dx) > Math.abs(dy)) {
        clearDrag()
        return
      }
      drag.from = offset()
      drag.height = height()
      drag.active = true
      ++serial
      cancelMotion()
      phase = 'dragging'
      handle.setAttribute('data-dragging', '')
    }
    const events = event.getCoalescedEvents?.()
    for (const point of events?.length ? events : [event]) sample(point)
    position(event.clientY)
  })
  const release = (event) => {
    if (!drag || drag.id !== event.pointerId) return
    const cancelled = event.type !== 'pointerup'
    sample(event)
    if (drag.active && !cancelled) position(event.clientY)
    const first = drag.samples[0],
      last = drag.samples.at(-1)
    const velocity = (last.y - first.y) / Math.max(1, last.time - first.time)
    const { active, distance, height: size } = drag
    const dismiss =
      !cancelled &&
      (velocity > CLOSE_VELOCITY || distance + Math.max(0, velocity) * MOMENTUM_WINDOW > size * CLOSE_RATIO)
    clearDrag()
    if (active) void settle(distance, dismiss ? size : 0, dismiss)
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(handle, event, release)
  const dispose = () => {
    ++serial
    listeners.abort()
    finishClose()
    phase = 'disposed'
  }
  return { open, close, dispose }
}

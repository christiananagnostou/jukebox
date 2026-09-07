export const scrollBehavior = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'

/** Native dialog semantics with an interruptible sheet transition and a drag handle. */
export const createPlayerSheet = (panel, handle) => {
  let animation
  let serial = 0
  let drag = null
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const animate = async (from, to, closing = false) => {
    const token = ++serial
    animation?.cancel()
    if (!panel.animate || reduced()) return token
    animation = panel.animate([{ transform: `translateY(${from})` }, { transform: `translateY(${to})` }], {
      duration: closing ? 220 : 340,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
    })
    try {
      await animation.finished
    } catch {
      /* Reopening or dragging replaces the transition. */
    }
    return token
  }
  const open = async () => {
    const from = panel.open ? getComputedStyle(panel).transform : 'none'
    animation?.cancel()
    if (!panel.open) panel.showModal()
    panel.scrollTop = 0
    // A repeated open during dismissal resumes from the current visual position.
    const offset =
      from !== 'none' && typeof DOMMatrixReadOnly !== 'undefined' ? `${new DOMMatrixReadOnly(from).m42}px` : '100%'
    const token = await animate(offset, '0px')
    if (token === serial) {
      animation?.cancel()
      panel.style.removeProperty('transform')
    }
  }
  const close = async (from) => {
    if (!panel.open) return
    const current = getComputedStyle(panel).transform
    const offset =
      from ??
      (current && current !== 'none' && typeof DOMMatrixReadOnly !== 'undefined'
        ? `${new DOMMatrixReadOnly(current).m42}px`
        : '0px')
    const token = await animate(offset, '100%', true)
    if (token !== serial) return
    panel.close()
    animation?.cancel()
    panel.style.removeProperty('transform')
  }
  panel.addEventListener('cancel', (event) => {
    event.preventDefault()
    void close()
  })
  panel.addEventListener('click', (event) => {
    if (event.target === panel) void close()
  })
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    ++serial
    animation?.cancel()
    drag = { y: event.clientY, time: performance.now(), distance: 0 }
    handle.setPointerCapture(event.pointerId)
  })
  handle.addEventListener('pointermove', (event) => {
    if (!drag) return
    drag.distance = Math.max(0, event.clientY - drag.y)
    panel.style.transform = `translateY(${drag.distance}px)`
  })
  const release = async (event) => {
    if (!drag) return
    const { distance, time } = drag
    drag = null
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    const dismiss =
      event.type !== 'pointercancel' &&
      (distance > Math.min(140, panel.clientHeight * 0.22) ||
        (distance > 30 && distance / Math.max(1, performance.now() - time) > 0.6))
    if (dismiss) await close(`${distance}px`)
    else {
      const token = await animate(`${distance}px`, '0px')
      if (token === serial) {
        animation?.cancel()
        panel.style.removeProperty('transform')
      }
    }
  }
  handle.addEventListener('pointerup', release)
  handle.addEventListener('pointercancel', release)
  const dispose = () => {
    ++serial
    animation?.cancel()
    drag = null
    if (panel.open) panel.close()
  }
  return { open, close, dispose }
}

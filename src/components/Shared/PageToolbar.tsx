import { component$, Slot, useSignal, useVisibleTask$ } from '@builder.io/qwik'

/** Fixed panel chrome. The page below owns scrolling; menus may extend outside this bar. */
export const PageToolbar = component$((props: { title: string; id?: string; secondary?: boolean }) => {
  const root = useSignal<HTMLElement>()
  useVisibleTask$(({ cleanup }) => {
    const element = root.value
    if (!element) return
    const dismiss = (event: PointerEvent) => {
      element.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((menu) => {
        if (!menu.contains(event.target as Node)) menu.open = false
      })
    }
    const escape = (event: KeyboardEvent) => {
      // Typing or activating a toolbar control must not also trigger library shortcuts.
      event.stopPropagation()
      if (event.key !== 'Escape') return
      const menu = element.querySelector<HTMLDetailsElement>('details[open]')
      if (!menu) return
      menu.open = false
      menu.querySelector('summary')?.focus()
    }
    element.ownerDocument.addEventListener('pointerdown', dismiss)
    element.addEventListener('keydown', escape)
    cleanup(() => {
      element.ownerDocument.removeEventListener('pointerdown', dismiss)
      element.removeEventListener('keydown', escape)
    })
  })
  return (
    <header ref={root} class="page-toolbar" aria-label={`${props.title} tools`} stoppropagation:keydown>
      {props.secondary ? (
        <h2 id={props.id} title={props.title}>
          {props.title}
        </h2>
      ) : (
        <h1 id={props.id} title={props.title}>
          {props.title}
        </h1>
      )}
      <div class="page-toolbar-actions">
        <Slot />
      </div>
    </header>
  )
})

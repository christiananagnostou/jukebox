import {
  type Component,
  type JSXOutput,
  $,
  Slot,
  component$,
  useSignal,
  useTask$,
  useVisibleTask$,
} from '@builder.io/qwik'

import type { ListItemStyle } from '~/App'

type Props = {
  listWrapClass?: string
  numItems: number
  itemHeight: number
  renderItem: Component<{ index: number; style: ListItemStyle }>
  overscan?: number
  scrollToRow?: number
}

export default component$((props: Props) => {
  const { numItems, itemHeight, renderItem, overscan = 10, listWrapClass, scrollToRow } = props
  const scrollTop = useSignal(0)
  const viewportHeight = useSignal(0)
  const scrollRef = useSignal<HTMLDivElement>()

  const innerHeight = numItems * itemHeight
  const startIndex = Math.max(0, Math.floor(scrollTop.value / itemHeight) - overscan)
  const endIndex = Math.min(numItems - 1, Math.floor((scrollTop.value + viewportHeight.value) / itemHeight) + overscan)
  const items: JSXOutput[] = []

  for (let index = startIndex; index <= endIndex; index++) {
    const item = renderItem(
      {
        index,
        style: { position: 'absolute', top: `${index * itemHeight}px`, width: '100%' },
      },
      index.toString(),
      0
    )
    if (item) items.push(item)
  }

  useVisibleTask$(({ cleanup }) => {
    const scrollElement = scrollRef.value
    if (!scrollElement) return

    const updateViewportHeight = () => {
      viewportHeight.value = scrollElement.clientHeight
    }
    const resizeObserver = new ResizeObserver(updateViewportHeight)

    updateViewportHeight()
    resizeObserver.observe(scrollElement)
    cleanup(() => resizeObserver.disconnect())
  })

  useTask$(({ track }) => {
    const targetRow = track(() => scrollToRow)
    const height = track(() => viewportHeight.value)
    if (targetRow === undefined || targetRow < 0 || targetRow >= numItems || height === 0) return

    const visibleStart = Math.max(0, Math.floor(scrollTop.value / itemHeight))
    const visibleEnd = Math.min(numItems - 1, Math.floor((scrollTop.value + height) / itemHeight))

    if (targetRow < visibleStart) {
      scrollRef.value?.scrollTo({ top: targetRow * itemHeight, behavior: 'auto' })
    } else if (targetRow > visibleEnd) {
      scrollRef.value?.scrollTo({
        top: Math.max(0, targetRow * itemHeight - (height - itemHeight)),
        behavior: 'auto',
      })
    }
  })

  const onScroll = $((_: UIEvent, element: HTMLDivElement) => {
    scrollTop.value = element.scrollTop
  })

  return (
    <div class="scroll min-h-0 h-full w-full overflow-y-auto overflow-x-hidden" onScroll$={onScroll} ref={scrollRef}>
      <div class={['inner relative', listWrapClass]} style={{ height: `${innerHeight}px` }}>
        {items}
        <Slot />
      </div>
    </div>
  )
})

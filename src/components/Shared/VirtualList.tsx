import {
  type Component,
  type QRL,
  $,
  Slot,
  component$,
  useComputed$,
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
  onRangeChange?: QRL<(startIndex: number, endIndex: number) => void>
  scrollToRow?: number
}

export function computeVirtualRange(
  scrollTop: number,
  viewportHeight: number,
  itemHeight: number,
  numItems: number,
  overscan: number
): { endIndex: number; startIndex: number } {
  return {
    startIndex: Math.max(0, Math.floor(scrollTop / itemHeight) - overscan),
    endIndex: Math.min(numItems - 1, Math.floor((scrollTop + viewportHeight) / itemHeight) + overscan),
  }
}

export default component$((props: Props) => {
  const scrollTop = useSignal(0)
  const viewportHeight = useSignal(0)
  const scrollRef = useSignal<HTMLDivElement>()
  const innerHeight = useComputed$(() => props.numItems * props.itemHeight)
  const visibleIndexes = useComputed$(() => {
    const range = computeVirtualRange(
      scrollTop.value,
      viewportHeight.value,
      props.itemHeight,
      props.numItems,
      props.overscan ?? 10
    )
    if (range.endIndex < range.startIndex) return []
    return Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, offset) => range.startIndex + offset)
  })

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
    const targetRow = track(() => props.scrollToRow)
    const height = track(() => viewportHeight.value)
    const numItems = track(() => props.numItems)
    const itemHeight = track(() => props.itemHeight)
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

  useTask$(({ track }) => {
    const top = track(() => scrollTop.value)
    const height = track(() => viewportHeight.value)
    const count = track(() => props.numItems)
    const itemHeight = track(() => props.itemHeight)
    const overscan = track(() => props.overscan ?? 10)
    if (!props.onRangeChange || !count || !height) return

    const range = computeVirtualRange(top, height, itemHeight, count, overscan)
    void props.onRangeChange(range.startIndex, range.endIndex)
  })

  const onScroll = $((_: UIEvent, element: HTMLDivElement) => {
    scrollTop.value = element.scrollTop
  })

  return (
    <div class="scroll min-h-0 h-full w-full overflow-y-auto overflow-x-hidden" onScroll$={onScroll} ref={scrollRef}>
      <div class={['inner relative', props.listWrapClass]} style={{ height: `${innerHeight.value}px` }}>
        {visibleIndexes.value.map((index) =>
          props.renderItem(
            {
              index,
              style: { position: 'absolute', top: `${index * props.itemHeight}px`, width: '100%' },
            },
            index.toString(),
            0
          )
        )}
        <Slot />
      </div>
    </div>
  )
})

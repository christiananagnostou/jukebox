import { type Component, $, component$, useSignal, useTask$, Slot, type JSXOutput } from '@builder.io/qwik'
import type { ListItemStyle } from '~/App'

type Props = {
  listWrapClass?: string
  numItems: number
  itemHeight: number
  windowHeight: number
  renderItem: Component<{ index: number; style: ListItemStyle }>
  overscan?: number
  scrollToRow?: number
}

export default component$((props: Props) => {
  const { numItems, itemHeight, renderItem, windowHeight, overscan = 10, listWrapClass, scrollToRow } = props

  const scrollTop = useSignal(0)
  const scrollRef = useSignal<HTMLDivElement>()

  // Height calculated from size of input
  const innerHeight = numItems * itemHeight
  // Calc index of first shown element
  const startIndex = Math.max(0, Math.floor(scrollTop.value / itemHeight) - overscan)
  // Calc index of last shown element
  const endIndex = Math.min(
    numItems - 1, // don't render past the end of the list
    Math.floor((scrollTop.value + windowHeight) / itemHeight) + overscan
  )

  // Elements to be rendered
  const items: JSXOutput[] = []

  ;(async () => {
    for (let i = startIndex; i <= endIndex; i++) {
      const elem = renderItem(
        {
          index: i,
          style: { position: 'absolute', top: `${i * itemHeight}px`, width: '100%' },
        },
        i.toString(),
        0
      )
      if (elem) items.push(elem)
    }
  })()

  useTask$(({ track }) => {
    const toRow = track(() => scrollToRow)

    // Calc index of first shown element
    const visibleStart = Math.max(0, Math.floor(scrollTop.value / itemHeight))
    // Calc index of last shown element
    const visibleEnd = Math.min(
      numItems - 1, // don't render past the end of the list
      Math.floor((scrollTop.value + windowHeight) / itemHeight)
    )

    // Scroll to a new element if scrollToRow is set and out of view
    if (toRow != undefined && (toRow <= visibleStart || toRow >= visibleEnd)) {
      const startDiff = Math.abs(visibleStart - toRow)
      const endDiff = Math.abs(visibleEnd - toRow)
      const isCloserToTop = startDiff < endDiff

      scrollRef.value?.scrollTo({
        top: isCloserToTop ? toRow * itemHeight : toRow * itemHeight - (windowHeight - itemHeight),
        behavior: 'auto',
      })
    }
  })

  const onScroll = $((_: UIEvent, element: HTMLDivElement) => {
    scrollTop.value = element.scrollTop
  })

  return (
    <div class="scroll overflow-y-scroll overflow-x-hidden w-full h-full" onScroll$={onScroll} ref={scrollRef}>
      <div class={`inner relative ${listWrapClass}`} style={{ height: `${innerHeight}px` }}>
        {items}
        <Slot />
      </div>
    </div>
  )
})

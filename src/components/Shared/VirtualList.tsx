import { $, component$, useSignal, type QwikUIEvent, type Component, type JSXNode } from '@builder.io/qwik'
import type { ListItemStyle } from '~/App'

type Props = {
  listWrapClass?: string
  numItems: number
  itemHeight: number
  windowHeight: number
  renderItem: Component<{ index: number; style: ListItemStyle }>
  overscan?: number
}

export default component$((props: Props) => {
  const { numItems, itemHeight, renderItem, windowHeight, overscan = 10, listWrapClass } = props

  const scrollTop = useSignal(0)

  const innerHeight = numItems * itemHeight
  const startIndex = Math.max(0, Math.floor(scrollTop.value / itemHeight) - overscan)
  const endIndex = Math.min(
    numItems - 1, // don't render past the end of the list
    Math.floor((scrollTop.value + windowHeight) / itemHeight) + overscan
  )

  const items: JSXNode[] = []

  ;(async () => {
    for (let i = startIndex; i <= endIndex; i++) {
      const elem = renderItem(
        { index: i, style: { position: 'absolute', top: `${i * itemHeight}px`, width: '100%' } },
        '' + i,
        0
      )
      if (elem) items.push(elem)
    }
  })()

  const onScroll = $((_: QwikUIEvent<HTMLDivElement>, element: HTMLDivElement) => (scrollTop.value = element.scrollTop))

  return (
    <div class="scroll overflow-auto w-full h-full" onScroll$={onScroll}>
      <div class={`inner relative ${listWrapClass}`} style={{ height: `${innerHeight}px` }}>
        {items}
      </div>
    </div>
  )
})

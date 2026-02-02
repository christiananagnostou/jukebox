import { component$, useContext } from '@builder.io/qwik'
import { StoreContext } from '~/routes/layout'

export default component$(() => {
  const store = useContext(StoreContext)

  const progressText = store.sync.total > 0 ? ` ${store.sync.processed}/${store.sync.total}` : ''
  let statusText = ''

  if (store.sync.status === 'scanning') {
    statusText = `Scanning${progressText}`
  } else if (store.sync.status === 'importing') {
    statusText = `Importing${progressText}`
  } else if (store.sync.status === 'error') {
    statusText = store.sync.message || 'Sync error'
  } else if (store.sync.lastRunAt) {
    statusText = `Last scan ${new Date(store.sync.lastRunAt).toLocaleTimeString()}`
  } else {
    statusText = 'Ready'
  }

  return (
    <div
      class="fixed top-0 left-0 right-0 z-30 border-b border-gray-700 bg-[var(--body-bg-solid)] text-xs text-gray-300"
      style={{ height: 'var(--status-bar-height)' }}
    >
      <div class="flex items-center justify-between h-full px-3">
        <span class="text-gray-400">{store.allSongs.length} songs</span>
        <span class="text-gray-400">{statusText}</span>
      </div>
    </div>
  )
})

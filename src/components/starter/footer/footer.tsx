import { component$, useStore } from '@builder.io/qwik'
// import { useServerTimeLoader } from '~/routes/layout'

export default component$(() => {
  // const serverTime = useServerTimeLoader()

  const store = useStore({ searchValue: '' })
  return (
    <footer
      class="px-2 w-full flex gap-2 items-center border-t border-gray-700 sticky bottom-0 bg-[#17171f]"
      style={{ height: 30 + 'px' }}
    >
      {/* <span>{serverTime.value.date}</span> */}

      <input
        type="text"
        name="Search"
        id="search-input"
        value={store.searchValue}
        onChange$={(e) => (store.searchValue = e.target.value)}
        class="bg-inherit border border-gray-700 rounded flex-1 px-2 "
      />
    </footer>
  )
})

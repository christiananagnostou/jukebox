import { component$ } from '@builder.io/qwik'

export const ClosedFolder = component$(() => {
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      stroke-width="0"
      viewBox="0 0 24 24"
      height="1.4em"
      width="1.4em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4 20q-.825 0-1.412-.587Q2 18.825 2 18V6q0-.825.588-1.412Q3.175 4 4 4h5.175q.4 0 .763.15.362.15.637.425L12 6h8q.825 0 1.413.588Q22 7.175 22 8v10q0 .825-.587 1.413Q20.825 20 20 20zM4 6v12h16V8h-8.825l-2-2H4zm0 0v12z"></path>
    </svg>
  )
})

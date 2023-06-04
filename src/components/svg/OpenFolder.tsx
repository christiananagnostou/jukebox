import { component$ } from '@builder.io/qwik'

export const OpenFolder = component$(() => {
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
      <path d="M4 20q-.825 0-1.412-.587Q2 18.825 2 18V6q0-.825.588-1.412Q3.175 4 4 4h5.175q.4 0 .763.15.362.15.637.425L12 6h8q.825 0 1.413.588Q22 7.175 22 8H11.175l-2-2H4v12l1.975-6.575q.2-.65.738-1.038Q7.25 10 7.9 10h12.9q1.025 0 1.613.812.587.813.312 1.763l-1.8 6q-.2.65-.737 1.038Q19.65 20 19 20zm2.1-2H19l1.8-6H7.9zm0 0l1.8-6-1.8 6zM4 10V6v4z"></path>
    </svg>
  )
})

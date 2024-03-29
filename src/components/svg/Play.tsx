import { component$ } from '@builder.io/qwik'

export const Play = component$(() => {
  return (
    <svg
      stroke="currentColor"
      fill="none"
      stroke-width="1"
      viewBox="0 0 24 24"
      stroke-linecap="round"
      stroke-linejoin="round"
      height="2em"
      width="2em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
      <path d="M7 4v16l13 -8z"></path>
    </svg>
  )
})

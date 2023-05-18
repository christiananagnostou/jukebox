import { component$ } from '@builder.io/qwik'

export const PrevTrack = component$(() => {
  return (
    <svg
      stroke="currentColor"
      fill="none"
      strokeWidth="2"
      viewBox="0 0 24 24"
      strokeLinecap="round"
      strokeLinejoin="round"
      height="2em"
      width="2em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
      <path d="M21 5v14l-8 -7z"></path>
      <path d="M10 5v14l-8 -7z"></path>
    </svg>
  )
})

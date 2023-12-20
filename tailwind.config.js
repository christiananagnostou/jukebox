/** @type {import('tailwindcss').Config} */
const plugin = require('tailwindcss/plugin')

module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {},
  },
  plugins: [
    plugin(function({ addVariant, matchVariant }) {
      addVariant('optional', '&:optional')
      addVariant('hocus', ['&:hover', '&:focus'])
      addVariant('inverted-colors', '@media (inverted-colors: inverted)')
      addVariant('not-first', '&:not(:first-child)')
      addVariant('not-last', '&:not(:last-child)')
      matchVariant('not-nth', (value) => `&:not(:nth-child(${value}))`)
    })
  ],
}

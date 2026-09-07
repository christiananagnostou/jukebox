import { defineConfig } from 'vite'
import { qwikVite } from '@builder.io/qwik/optimizer'

export default defineConfig({
  publicDir: false,
  plugins: [
    qwikVite({
      srcDir: 'src/mobile',
      client: { input: 'src/mobile/root.tsx', outDir: '.mobile-dist' },
      ssr: { input: 'src/mobile/entry.ssr.tsx', outDir: '.mobile-ssr' },
    }),
  ],
  build: { sourcemap: false, rollupOptions: { output: { entryFileNames: '[name].mjs' } } },
})

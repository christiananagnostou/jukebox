import { build } from 'vite'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const output = resolve('.mobile-dist')
await build({ configFile: 'vite.mobile.config.ts' })
await build({ configFile: 'vite.mobile.config.ts', build: { ssr: true } })
const manifest = JSON.parse(await readFile(join(output, 'q-manifest.json'), 'utf8'))
const { render } = await import(pathToFileURL(resolve('.mobile-ssr/entry.ssr.mjs')).href)
const result = await render({ manifest, base: '/build/', prefetchStrategy: null })
await mkdir(join(output, 'build'), { recursive: true })
// Keep the existing strict CSP: generated executable bootstrap scripts are same-origin files,
// not an excuse to add unsafe-inline. Qwik's serialized JSON is inert data, not executable code.
const scripts = []
const html = result.html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (original, attributes, content) => {
  if (
    /\bsrc\s*=/.test(attributes) ||
    /type=["'](?:qwik\/json|application\/json)["']/.test(attributes) ||
    !content.trim()
  )
    return original
  const name = `bootstrap-${createHash('sha256').update(content).digest('hex').slice(0, 16)}.js`
  scripts.push(writeFile(join(output, 'build', name), content))
  return `<script${attributes} src="/build/${name}"></script>`
})
await Promise.all(scripts)
await writeFile(join(output, 'index.html'), html)
const source = 'src-tauri/src/remote_access'
for (const file of ['app.css', 'data-cache.js', 'manifest.webmanifest'])
  await copyFile(join(source, file), join(output, file))
await mkdir(join(output, 'icons'), { recursive: true })
await copyFile(join(source, 'icon-192.png'), join(output, 'icons/icon-192.png'))
await copyFile('src-tauri/icons/icon.png', join(output, 'icons/icon-512.png'))
const paths = ['/', '/app.css', '/data-cache.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']
const collect = async (directory, prefix) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await collect(join(directory, entry.name), `${prefix}/${entry.name}`)
    else if (/\.(?:js|mjs|css|json)$/.test(entry.name)) paths.push(`${prefix}/${entry.name}`)
  }
}
await collect(join(output, 'build'), '/build')
await collect(join(output, 'assets'), '/assets')
const hash = createHash('sha256')
for (const path of paths.sort()) hash.update(await readFile(join(output, path === '/' ? 'index.html' : path.slice(1))))
const sw = await readFile(join(source, 'sw.js'), 'utf8')
hash.update(sw)
await writeFile(
  join(output, 'sw.js'),
  sw.replace(
    '/* MOBILE_SHELL */',
    `const BUILD_SHELL = ${JSON.stringify({ version: hash.digest('hex').slice(0, 16), paths })}`
  )
)
console.log(`Mobile Qwik shell built: ${paths.length} precached assets. No runtime Node server.`)

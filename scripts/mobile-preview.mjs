// Synthetic, loopback-only test server for the production mobile build. Never serves user music.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

const root = resolve('.mobile-dist')
const tracks = Array.from({ length: 6 }, (_, i) => ({
  id: String(i),
  title: `Song ${i + 1}`,
  file: `${i}.wav`,
  artist: i < 3 ? 'First artist' : 'Guest artist',
  album: 'Together',
  duration: '0:30',
  codec: 'wav',
}))
const wave = Buffer.alloc(44 + 8000 * 2 * 30)
wave.write('RIFF')
wave.writeUInt32LE(wave.length - 8, 4)
wave.write('WAVEfmt ', 8)
wave.writeUInt32LE(16, 16)
wave.writeUInt16LE(1, 20)
wave.writeUInt16LE(1, 22)
wave.writeUInt32LE(8000, 24)
wave.writeUInt32LE(16000, 28)
wave.writeUInt16LE(2, 32)
wave.writeUInt16LE(16, 34)
wave.write('data', 36)
wave.writeUInt32LE(wave.length - 44, 40)
let offline = false
const csp =
  "default-src 'none'; style-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'"
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/test/network' && req.method === 'POST') {
        offline = url.searchParams.get('offline') === '1'
        res.end('ok')
        return
      }
      if (offline) {
        res.writeHead(503)
        res.end('Test host unavailable')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      if (/^\/api\/tracks\/\d+\/stream$/.test(url.pathname)) {
        const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
        const start = range ? Number(range[1]) : 0
        const end = range?.[2] ? Math.min(Number(range[2]), wave.length - 1) : wave.length - 1
        res.setHeader('Content-Type', 'audio/wav')
        res.setHeader('Accept-Ranges', 'bytes')
        if (range) {
          res.statusCode = 206
          res.setHeader('Content-Range', `bytes ${start}-${end}/${wave.length}`)
        }
        res.setHeader('Content-Length', end - start + 1)
        res.end(wave.subarray(start, end + 1))
        return
      }
      if (url.pathname.includes('artwork')) {
        res.setHeader('Content-Type', 'image/png')
        res.end(await readFile(resolve('src-tauri/src/remote_access/icon-192.png')))
        return
      }
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-jukebox-catalog-revision', '1')
        const q = (url.searchParams.get('q') || '').toLowerCase()
        res.end(
          JSON.stringify(
            url.pathname === '/api/tracks'
              ? tracks.filter((t) => t.title.toLowerCase().includes(q))
              : url.pathname === '/api/artists'
                ? {
                    items: [{ name: 'First artist', value: 'First artist', albumCount: 1, trackCount: 6 }],
                    total: 1,
                    revision: 1,
                  }
                : {
                    items: [
                      {
                        name: 'Together',
                        value: 'Together',
                        artist: 'Various Artists',
                        artistValue: '',
                        date: '2026',
                        trackCount: 6,
                      },
                    ],
                    total: 1,
                    revision: 1,
                  }
          )
        )
        return
      }
      const path = resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`)
      if (!path.startsWith(root + sep) || path.endsWith('q-manifest.json')) {
        res.writeHead(404)
        res.end()
        return
      }
      const content = await readFile(path)
      const mime = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.png': 'image/png',
      }[extname(path)]
      res.setHeader('Content-Type', mime || 'application/octet-stream')
      res.setHeader('Cache-Control', 'no-store')
      if (path.endsWith('index.html')) res.setHeader('Content-Security-Policy', csp)
      res.end(content)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  })
  .listen(45324, '127.0.0.1', () => console.log('Mobile fixture: http://127.0.0.1:45324'))

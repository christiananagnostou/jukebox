import { readFile } from 'node:fs/promises'

const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const capability = JSON.parse(
  await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8')
)
const main = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')

const failures = []
const expectedPermissions = ['core:default', 'dialog:allow-message']
const expectedScope = ['$APPLOCALDATA/Jukebox/art/**']
const csp = config.app?.security?.csp
const devCsp = config.app?.security?.devCsp
const assetProtocol = config.app?.security?.assetProtocol

if (JSON.stringify(capability.permissions) !== JSON.stringify(expectedPermissions)) {
  failures.push(`main capability must be exactly ${JSON.stringify(expectedPermissions)}`)
}
if (!assetProtocol?.enable || JSON.stringify(assetProtocol.scope) !== JSON.stringify(expectedScope)) {
  failures.push(`asset protocol scope must be exactly ${JSON.stringify(expectedScope)}`)
}
if (typeof csp !== 'string' || !csp.trim()) failures.push('production CSP must be non-empty')
if (typeof devCsp !== 'string' || !devCsp.trim()) failures.push('development CSP must be non-empty')

for (const directive of [
  "default-src 'self'",
  "connect-src 'self' ipc: http://ipc.localhost",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
]) {
  if (typeof csp === 'string' && !csp.includes(directive)) failures.push(`production CSP is missing: ${directive}`)
}
if (typeof csp === 'string' && csp.includes("script-src 'self' 'unsafe-inline'")) {
  failures.push('production script policy must not allow inline scripts')
}
if (!main.includes('authorize_playback_asset')) failures.push('native playback asset command is not registered')
if (!main.includes('pick_import_directories')) failures.push('native folder picker command is not registered')

if (failures.length) {
  console.error('Desktop security check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Desktop security check passed.')

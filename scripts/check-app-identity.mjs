import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(resolve(projectRoot, 'src-tauri/tauri.conf.json'), 'utf8'))
const cargo = readFileSync(resolve(projectRoot, 'src-tauri/Cargo.toml'), 'utf8')
const database = readFileSync(resolve(projectRoot, 'src-tauri/src/database.rs'), 'utf8')
const main = readFileSync(resolve(projectRoot, 'src-tauri/src/main.rs'), 'utf8')
const playbackAssets = readFileSync(resolve(projectRoot, 'src-tauri/src/playback_assets.rs'), 'utf8')
const failures = []

function requireCondition(condition, message) {
  if (!condition) failures.push(message)
}

requireCondition(
  config.identifier === 'com.jukebox.app',
  'bundle identifier must preserve the established identity until a signed permission migration exists'
)
requireCondition(config.bundle?.category === 'Music', 'bundle category must be Music')
requireCondition(Boolean(config.bundle?.shortDescription), 'bundle short description must be present')
requireCondition(Boolean(config.bundle?.longDescription), 'bundle long description must be present')
requireCondition(Boolean(config.bundle?.copyright), 'bundle copyright must be present')
requireCondition(config.plugins?.sql === undefined, 'renderer SQL preload must remain absent')

requireCondition(/^name = "jukebox"$/m.test(cargo), 'Rust package must be named jukebox')
requireCondition(/^default-run = "jukebox"$/m.test(cargo), 'Rust default binary must be jukebox')
requireCondition(/^license = "GPL-3\.0-only"$/m.test(cargo), 'Rust package must declare GPL-3.0-only')
requireCondition(
  /^repository = "https:\/\/github\.com\/christiananagnostou\/jukebox"$/m.test(cargo),
  'Rust package must declare the public repository'
)
requireCondition(!cargo.includes('tauri-plugin-sql'), 'unused Tauri SQL plugin must remain removed')
requireCondition(!/^authors = \["you"\]$/m.test(cargo), 'placeholder Rust author must remain removed')

const migrationVersions = readdirSync(resolve(projectRoot, 'src-tauri/migrations'))
  .map((name) => Number.parseInt(name.split('_', 1)[0], 10))
  .filter(Number.isFinite)
const latestMigration = Math.max(...migrationVersions)
requireCondition(
  database.includes(`const LATEST_SCHEMA_VERSION: i64 = ${latestMigration};`),
  'diagnostic schema version must match the latest native migration'
)

const diagnosticsIndex = main.indexOf('DiagnosticsState::new(app.handle()')
const settingsIndex = main.indexOf('load_settings(app.handle())')
const libraryIndex = main.indexOf('LibraryState::new(app.handle())')
requireCondition(
  diagnosticsIndex >= 0 && diagnosticsIndex < settingsIndex && settingsIndex < libraryIndex,
  'diagnostics, settings, and library initialization must retain their startup order'
)
requireCondition(
  main.includes('PlaybackAssetServer::start('),
  'startup must initialize the nonblocking playback server'
)
requireCondition(
  playbackAssets.includes('TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))'),
  'playback server must bind an ephemeral loopback port'
)
requireCondition(
  playbackAssets.includes('getrandom::fill(&mut bytes)') && playbackAssets.includes('/media/{token}/{track_id}'),
  'playback streams must require a per-process random token'
)

if (failures.length) {
  console.error('App identity check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('App identity check passed.')
}

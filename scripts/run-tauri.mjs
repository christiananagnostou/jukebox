import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const env = { ...process.env }

if (args[0] === 'build') {
  if (env.RUSTFLAGS && !env.CARGO_ENCODED_RUSTFLAGS) {
    throw new Error('Portable builds require custom compiler flags in CARGO_ENCODED_RUSTFLAGS instead of RUSTFLAGS.')
  }

  const remapRoots = [
    [projectRoot, '/workspace'],
    [env.CARGO_HOME, '/build/cargo'],
    [env.RUSTUP_HOME, '/build/rustup'],
    [tmpdir(), '/build/temp'],
    [homedir(), '/build/home'],
  ]
  const existingFlags = (env.CARGO_ENCODED_RUSTFLAGS || '').split('\u001f').filter(Boolean)
  const remapFlags = remapRoots
    .filter(([source]) => source)
    .map(([source, destination]) => `--remap-path-prefix=${resolve(source)}=${destination}`)
  env.CARGO_ENCODED_RUSTFLAGS = [...existingFlags, ...remapFlags].join('\u001f')
}

const tauriCli = join(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const child = spawn(process.execPath, [tauriCli, ...args], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(`Unable to start the Tauri CLI: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})

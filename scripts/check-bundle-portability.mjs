import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const targets = process.argv.slice(2).map((target) => resolve(target))
const temporaryRoot = resolve(tmpdir())

if (!targets.length) {
  console.error('Usage: npm run check:bundle-portability -- <file-or-directory> [...]')
  process.exit(2)
}

const normalizedTemporaryRoot = temporaryRoot.replaceAll('\\', '/').replace(/\/$/, '')
const isGenericTemporaryRoot =
  ['/tmp', '/private/tmp', '/var/tmp'].includes(normalizedTemporaryRoot) ||
  /^[a-z]:\/(?:windows\/)?temp$/i.test(normalizedTemporaryRoot)

const forbiddenRoots = [
  ['builder home directory', homedir()],
  ['project checkout', projectRoot],
  ['Cargo home directory', process.env.CARGO_HOME],
  ['Rustup home directory', process.env.RUSTUP_HOME],
  ['temporary build directory', isGenericTemporaryRoot ? undefined : temporaryRoot],
]
  .filter(([, path]) => path)
  .flatMap(([label, path]) => {
    const resolved = resolve(path)
    return [
      [label, Buffer.from(resolved)],
      [label, Buffer.from(resolved.replaceAll('\\', '/'))],
    ]
  })

function filesWithin(target) {
  if (!existsSync(target)) {
    throw new Error(`Bundle portability target does not exist: ${relative(projectRoot, target)}`)
  }
  if (/^rw\.\d+\..+\.dmg$/.test(basename(target))) return []
  const stat = lstatSync(target)
  if (stat.isSymbolicLink()) return []
  if (stat.isFile()) return [target]
  if (!stat.isDirectory()) return []
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => filesWithin(resolve(target, entry.name)))
}

const violations = []
const files = [...new Set(targets.flatMap(filesWithin))]
for (const file of files) {
  const content = readFileSync(file)
  for (const [label, needle] of forbiddenRoots) {
    if (needle.length && content.indexOf(needle) !== -1) {
      violations.push(`${relative(projectRoot, file)}: embeds ${label}`)
      break
    }
  }
}

if (violations.length) {
  console.error('Bundle portability check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  console.error('Build through npm run tauri so compiler paths are remapped.')
  process.exitCode = 1
} else {
  console.log(`Bundle portability check passed (${files.length} files).`)
}

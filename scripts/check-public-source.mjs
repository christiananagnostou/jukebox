import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const slash = '/'
const backslash = '\\'
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)

const forbiddenPaths = [
  {
    label: 'macOS home-directory path',
    pattern: new RegExp(`${slash}Users${slash}[^${slash}\\s]+${slash}`, 'g'),
  },
  {
    label: 'Linux home-directory path',
    pattern: new RegExp(`${slash}home${slash}[^${slash}\\s]+${slash}`, 'g'),
  },
  {
    label: 'Windows home-directory path',
    pattern: new RegExp(
      `[A-Za-z]:${backslash.repeat(2)}Users${backslash.repeat(2)}[^${backslash.repeat(2)}\\s]+${backslash.repeat(2)}`,
      'g'
    ),
  },
  {
    label: 'shell home-directory path',
    pattern: new RegExp(
      `~${slash}(?:Desktop|Documents|Downloads|Music|Pictures|Projects|Development|dev|src|code|coding)${slash}`,
      'gi'
    ),
  },
]

const violations = []

for (const file of trackedFiles) {
  const content = readFileSync(file)
  if (content.includes(0)) continue

  const text = content.toString('utf8')
  const lines = text.split(/\r?\n/)
  for (const { label, pattern } of forbiddenPaths) {
    for (const [index, line] of lines.entries()) {
      pattern.lastIndex = 0
      if (pattern.test(line)) violations.push(`${file}:${index + 1}: ${label}`)
    }
  }
}

if (violations.length) {
  console.error('Public-source portability check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  console.error('Use runtime-selected paths or clearly synthetic, platform-neutral fixtures instead.')
  process.exitCode = 1
} else {
  console.log(`Public-source portability check passed (${trackedFiles.length} tracked files).`)
}

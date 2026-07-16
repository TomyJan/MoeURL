import { readFileSync } from 'node:fs'

const profile = process.argv[2] ?? 'coverage.out'
const threshold = Number(process.argv[3] ?? '100')
const includeFrom = readOption('--include-from')
const includes = includeFrom ? readPatterns(includeFrom) : []
const excludeBlocksFrom = readOption('--exclude-blocks-from')
const excludedBlocks = excludeBlocksFrom ? new Set(readPatterns(excludeBlocksFrom)) : new Set()
const excludedLineRanges = new Set([...excludedBlocks].map(toLineRange))
const lines = readFileSync(profile, 'utf8').trim().split('\n').slice(1)

let covered = 0
let total = 0

for (const line of lines) {
  const parts = line.trim().split(/\s+/)
  if (parts.length !== 3) continue

  const loc = parts[0]
  const file = loc.split(':')[0]
  if (includes.length > 0 && !includes.includes(file)) {
    continue
  }
  if (excludedBlocks.has(loc) || excludedLineRanges.has(toLineRange(loc))) {
    continue
  }

  const statements = Number(parts[1])
  const count = Number(parts[2])
  if (!Number.isFinite(statements) || !Number.isFinite(count)) {
    throw new Error(`Invalid coverage line: ${line}`)
  }
  total += statements
  if (count > 0) covered += statements
}

const percent = total === 0 ? 100 : (covered / total) * 100
console.log(`Go coverage: ${percent.toFixed(2)}%`)

if (percent + Number.EPSILON < threshold) {
  console.error(`Go coverage must be at least ${threshold}%`)
  process.exit(1)
}

function readOption(name) {
  const prefix = `${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))
  return value?.slice(prefix.length)
}

function readPatterns(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

function toLineRange(location) {
  const match = /^(.*):(\d+)\.\d+,(\d+)\.\d+$/.exec(location)
  return match ? `${match[1]}:${match[2]},${match[3]}` : location
}

import { readFileSync } from 'node:fs'

const profile = process.argv[2] ?? 'coverage.out'
const threshold = Number(process.argv[3] ?? '100')
const includeFrom = readOption('--include-from')
const includes = includeFrom ? readPatterns(includeFrom) : []
const excludeBlocksFrom = readOption('--exclude-blocks-from')
const excludedBlocks = excludeBlocksFrom ? new Set(readPatterns(excludeBlocksFrom)) : new Set()
const excludedLineRanges = new Set([...excludedBlocks].map(toLineRange))
const matchedExcludedBlocks = new Set()
const blocks = readFileSync(profile, 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map(parseBlock)
  .filter(Boolean)
let covered = 0
let total = 0
const uncoveredBlocks = []

for (const block of blocks) {
  const { count, file, loc, statements } = block
  if (includes.length > 0 && !includes.includes(file)) {
    continue
  }
  if (consumeExcludedBlock(loc)) {
    continue
  }
  total += statements
  if (count > 0) {
    covered += statements
  } else {
    uncoveredBlocks.push(loc)
  }
}

const unmatchedExcludedBlocks = [...excludedBlocks].filter((location) => !matchedExcludedBlocks.has(location))
if (unmatchedExcludedBlocks.length > 0) {
  console.error(`Unmatched configured coverage exclusions:\n${unmatchedExcludedBlocks.join('\n')}`)
  process.exitCode = 1
}

const percent = total === 0 ? 100 : (covered / total) * 100
console.log(`Go coverage: ${percent.toFixed(2)}%`)

if (percent + Number.EPSILON < threshold) {
  console.error(`Go coverage must be at least ${threshold}%`)
  console.error(`Uncovered blocks:\n${uncoveredBlocks.join('\n')}`)
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const location of uncoveredBlocks) {
      const match = /^(.*):(\d+)\.\d+/.exec(location)
      if (match) {
        console.error(`::error file=${match[1]},line=${match[2]}::Uncovered coverage block: ${location}`)
      }
    }
  }
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

function parseBlock(line) {
  const parts = line.trim().split(/\s+/)
  if (parts.length !== 3) return null
  const [loc, statementText, countText] = parts
  const statements = Number(statementText)
  const count = Number(countText)
  if (!Number.isFinite(statements) || !Number.isFinite(count)) {
    throw new Error(`Invalid coverage line: ${line}`)
  }
  return { loc, file: loc.split(':')[0], statements, count }
}

function consumeExcludedBlock(location) {
  if (excludedBlocks.has(location)) {
    matchedExcludedBlocks.add(location)
    return true
  }
  const lineRange = toLineRange(location)
  if (!excludedLineRanges.has(lineRange)) {
    return false
  }
  for (const configuredLocation of excludedBlocks) {
    if (toLineRange(configuredLocation) === lineRange) {
      matchedExcludedBlocks.add(configuredLocation)
    }
  }
  return true
}

function toLineRange(location) {
  const match = /^(.*):(\d+)\.\d+,(\d+)\.\d+$/.exec(location)
  return match ? `${match[1]}:${match[2]},${match[3]}` : location
}

import { readFileSync } from 'node:fs'

const profile = process.argv[2] ?? 'coverage.out'
const threshold = Number(process.argv[3] ?? '100')
const includeFrom = readOption('--include-from')
const includes = includeFrom ? readPatterns(includeFrom) : []
const excludeBlocksFrom = readOption('--exclude-blocks-from')
const excludedBlocks = excludeBlocksFrom ? new Set(readPatterns(excludeBlocksFrom)) : new Set()
const excludedLineRanges = new Set([...excludedBlocks].map(toLineRange))
const excludedBlocksByFile = groupBlocksByFile(excludedBlocks)
const blocks = readFileSync(profile, 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map(parseBlock)
  .filter(Boolean)
const fallbackExcludedBlocks = findFallbackExcludedBlocks(blocks, excludedBlocksByFile)

let covered = 0
let total = 0

for (const block of blocks) {
  const { count, file, loc, statements } = block
  if (includes.length > 0 && !includes.includes(file)) {
    continue
  }
  if (isExcludedBlock(loc) || fallbackExcludedBlocks.has(loc)) {
    continue
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

function groupBlocksByFile(blocks) {
  const grouped = new Map()
  for (const block of blocks) {
    const file = block.split(':')[0]
    grouped.set(file, (grouped.get(file) ?? 0) + 1)
  }
  return grouped
}

function findFallbackExcludedBlocks(blocks, configuredCounts) {
  const fallback = new Set()
  for (const [file, configuredCount] of configuredCounts) {
    const fileBlocks = blocks.filter((block) => block.file === file)
    const uncovered = fileBlocks.filter((block) => block.count === 0)
    const unmatched = uncovered.filter((block) => !isExcludedBlock(block.loc))
    const remainingConfiguredCount = configuredCount - fileBlocks.filter((block) => isExcludedBlock(block.loc)).length
    if (unmatched.length === 0 || remainingConfiguredCount <= 0) {
      continue
    }
    if (unmatched.length === remainingConfiguredCount) {
      for (const block of unmatched) fallback.add(block.loc)
    }
  }
  return fallback
}

function isExcludedBlock(location) {
  return excludedBlocks.has(location) || excludedLineRanges.has(toLineRange(location))
}

function toLineRange(location) {
  const match = /^(.*):(\d+)\.\d+,(\d+)\.\d+$/.exec(location)
  return match ? `${match[1]}:${match[2]},${match[3]}` : location
}

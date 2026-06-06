import { readFileSync } from 'node:fs'

const profile = process.argv[2] ?? 'coverage.out'
const threshold = Number(process.argv[3] ?? '100')
const lines = readFileSync(profile, 'utf8').trim().split('\n').slice(1)

let covered = 0
let total = 0

for (const line of lines) {
  const parts = line.trim().split(/\s+/)
  if (parts.length !== 3) continue

  const statements = Number(parts[1])
  const count = Number(parts[2])
  total += statements
  if (count > 0) covered += statements
}

const percent = total === 0 ? 100 : (covered / total) * 100
console.log(`Go coverage: ${percent.toFixed(2)}%`)

if (percent + Number.EPSILON < threshold) {
  console.error(`Go coverage must be at least ${threshold}%`)
  process.exit(1)
}

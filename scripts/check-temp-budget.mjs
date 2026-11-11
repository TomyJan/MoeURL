import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const MiB = 1024 ** 2
const limits = Object.freeze({ active: 4 * 1024 ** 3, total: 12 * 1024 ** 3, docker: 6 * 1024 ** 3 })

/** Rejects missing, negative, fractional or unsafe byte counts before arithmetic. */
function size(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Capacity must be a nonnegative safe integer')
  return value
}

/** Adds validated byte counts and refuses an unsafe combined total. */
function add(left, right) {
  return size(size(left) + size(right))
}

/** Accepts a single active-directory label and rejects paths or traversal names. */
function activeDirectory(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error('Active name must be one directory name, not a path')
  }
}

/** Folds Windows names conservatively; callers separately reject ambiguous roots. */
function pathKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/** Counts ordinary managed files, skipping links and rejecting incomplete inventories. */
export async function inspectTemporaryFiles(roots, activeName) {
  activeDirectory(activeName)
  if (!Array.isArray(roots) || roots.length === 0) throw new Error('At least one managed .tmp root is required')
  const physical = new Map()
  for (const root of roots) {
    if (typeof root !== 'string' || root.length === 0) throw new Error('Invalid temporary root')
    const absolute = resolve(root)
    if (basename(absolute) !== '.tmp') throw new Error('Managed root must be a .tmp directory')
    const info = await lstat(absolute)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Managed root must be an ordinary directory')
    const canonical = await realpath(absolute)
    const key = pathKey(canonical)
    if (physical.has(key) && physical.get(key) !== canonical) throw new Error('Ambiguous case-folded temporary roots')
    physical.set(key, canonical)
  }
  const keys = [...physical.keys()]
  for (const outer of keys) {
    if (keys.some(inner => inner !== outer && inner.startsWith(outer + sep))) {
      throw new Error('Managed temporary roots must not overlap')
    }
  }
  const result = { roots: [...physical.values()], activeBytes: 0, totalBytes: 0, files: 0, symlinksSkipped: 0 }
  for (const root of result.roots) {
    const pending = [{ path: root, active: false, top: true }]
    while (pending.length) {
      const current = pending.pop()
      for (const name of await readdir(current.path)) {
        const path = join(current.path, name)
        const info = await lstat(path)
        if (info.isSymbolicLink()) {
          result.symlinksSkipped++
        } else if (info.isDirectory()) {
          pending.push({ path, active: current.active || (current.top && pathKey(name) === pathKey(activeName)), top: false })
        } else if (info.isFile()) {
          result.totalBytes = add(result.totalBytes, info.size)
          if (current.active) result.activeBytes = add(result.activeBytes, info.size)
          result.files++
        } else {
          throw new Error('Unsupported temporary filesystem entry: ' + path)
        }
      }
    }
  }
  return result
}

/** Rejects an operation whose reserve crosses any independently enforced budget. */
export function evaluateBudget({ activeBytes, totalBytes, reserveBytes, dockerCacheBytes = 0 }) {
  for (const value of [activeBytes, totalBytes, reserveBytes, dockerCacheBytes]) size(value)
  if (activeBytes > totalBytes) throw new Error('Active capacity cannot exceed total capacity')
  const prospective = {
    active: add(activeBytes, reserveBytes),
    total: add(totalBytes, reserveBytes),
    docker: add(dockerCacheBytes, reserveBytes),
  }
  const violations = Object.keys(limits).filter(key => prospective[key] > limits[key])
  return { allowed: violations.length === 0, violations, limits, prospective }
}

/** Parses exactly one Docker build-cache row with conservative CLI rounding margin. */
export function parseDockerReclaimable(output) {
  if (typeof output !== 'string' || !output.trim()) throw new Error('Docker inventory is empty')
  const rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line))
  const caches = rows.filter(row => row && typeof row === 'object' && row.Type === 'Build Cache')
  if (caches.length !== 1 || typeof caches[0].Reclaimable !== 'string') throw new Error('Ambiguous Docker build-cache inventory')
  const match = /^(\d+(?:\.\d+)?)(B|kB|MB|GB|TB)(?: \((\d+(?:\.\d+)?)%\))?$/.exec(caches[0].Reclaimable)
  if (!match || (match[3] !== undefined && Number(match[3]) > 100)) throw new Error('Invalid Docker reclaimable size')
  const units = { B: 1, kB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, TB: 1000 ** 4 }
  return add(size(Math.ceil(Number(match[1]) * units[match[2]])), 16 * MiB)
}

/** Parses the explicit root list and reserve, rejecting ambiguous or incomplete CLI input. */
function options(args) {
  const result = { roots: [], reserveBytes: 256 * MiB, docker: false }
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (!['--root', '--active', '--reserve-mib', '--docker'].includes(flag)) throw new Error('Unknown option: ' + flag)
    if (flag !== '--root' && seen.has(flag)) throw new Error('Repeated option: ' + flag)
    seen.add(flag)
    if (flag === '--docker') {
      result.docker = true
      continue
    }
    const value = args[++i]
    if (value === undefined || value.startsWith('--')) throw new Error('Missing value: ' + flag)
    if (flag === '--root') result.roots.push(value)
    if (flag === '--active') result.activeName = value
    if (flag === '--reserve-mib') {
      if (!/^\d+$/.test(value)) throw new Error('Reserve MiB must be a nonnegative integer')
      result.reserveBytes = size(size(Number(value)) * MiB)
    }
  }
  if (!result.roots.length) throw new Error('At least one --root is required')
  activeDirectory(result.activeName)
  return result
}

/** Completes the read-only inventory before reporting whether reserved work fits all budgets. */
async function main() {
  const args = options(process.argv.slice(2))
  const inventory = await inspectTemporaryFiles(args.roots, args.activeName)
  let dockerCacheBytes = 0
  if (args.docker) {
    const result = spawnSync('docker', ['system', 'df', '--format', '{{json .}}'], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: MiB, windowsHide: true,
    })
    if (result.error || result.status !== 0) throw new Error('Docker inventory failed; no operation is authorized')
    dockerCacheBytes = parseDockerReclaimable(result.stdout)
  }
  const budget = evaluateBudget({ ...inventory, reserveBytes: args.reserveBytes, dockerCacheBytes })
  console.log(JSON.stringify({ ...inventory, reserveBytes: args.reserveBytes, dockerChecked: args.docker, dockerCacheBytes, ...budget }))
  process.exitCode = budget.allowed ? 0 : 1
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Temporary capacity check failed')
    process.exitCode = 2
  }
}

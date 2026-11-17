const fs = require('fs')
const path = require('path')
const { parse } = require('jsonc-parser')

/**
 * File-system helpers. Everything here is plain Node (no vscode), and every
 * lookup is done when a script is started, never cached from the moment the
 * buttons were built: lockfiles, node_modules and version files change.
 */

async function exists(p) {
  try {
    await fs.promises.stat(p)
    return true
  } catch {
    return false
  }
}

async function readText(p) {
  try {
    return await fs.promises.readFile(p, 'utf8')
  } catch {
    return null
  }
}

/** Returns the parsed package.json, or null when missing or not an object. */
async function readPackageJson(file) {
  const text = await readText(file)
  if (text === null) return null
  try {
    const pkg = parse(text)
    return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? pkg : null
  } catch {
    return null
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Directories from `startDir` up to `stopDir` (inclusive). A nested package
 * inherits the lockfile, node_modules and Node version of the project root.
 */
function ancestorDirs(startDir, stopDir) {
  const dirs = []
  let dir = path.resolve(startDir)
  const stop = stopDir && isInside(dir, path.resolve(stopDir)) ? path.resolve(stopDir) : dir
  for (;;) {
    dirs.push(dir)
    if (dir === stop) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirs
}

function parsePackageManagerField(value) {
  if (typeof value !== 'string') return null
  if (value.startsWith('pnpm')) return 'pnpm'
  if (value.startsWith('yarn@1')) return 'yarn'
  if (value.startsWith('yarn')) return 'yarn-berry'
  if (value.startsWith('bun')) return 'bun'
  if (value.startsWith('npm')) return 'npm'
  return null
}

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['.yarnrc.yml', 'yarn-berry'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
]

/**
 * Detects the package manager, looking at the project folder first and then
 * at its parents up to the workspace folder. Returns the folder that decided
 * it (`rootDir`), which is where a monorepo keeps its lockfile.
 */
async function detectPackageManager(projectDir, stopDir) {
  for (const dir of ancestorDirs(projectDir, stopDir)) {
    const pkg = await readPackageJson(path.join(dir, 'package.json'))
    const fromField = parsePackageManagerField(pkg?.packageManager)
    if (fromField) return { pm: fromField, rootDir: dir, source: 'packageManager field' }
    for (const [file, pm] of LOCKFILES) {
      if (await exists(path.join(dir, file))) return { pm, rootDir: dir, source: file }
    }
    if (await exists(path.join(dir, 'bunfig.toml'))) return { pm: 'bun', rootDir: dir, source: 'bunfig.toml' }
  }
  return { pm: 'npm', rootDir: projectDir, source: 'default' }
}

async function hasInstallMarker(dir, pm) {
  if (await exists(path.join(dir, 'node_modules'))) return true
  if (pm === 'yarn' || pm === 'yarn-berry') {
    // Yarn Berry in PnP mode installs without a node_modules folder.
    return (
      (await exists(path.join(dir, '.yarn', 'install-state.gz'))) ||
      (await exists(path.join(dir, '.pnp.cjs'))) ||
      (await exists(path.join(dir, '.pnp.js')))
    )
  }
  return false
}

/**
 * True when dependencies look installed. A workspace package can have its
 * dependencies hoisted to the root, so the lockfile folder counts too.
 */
async function checkDependenciesInstalled(projectDir, pm, rootDir) {
  if (await hasInstallMarker(projectDir, pm)) return true
  if (rootDir && path.resolve(rootDir) !== path.resolve(projectDir)) {
    return hasInstallMarker(rootDir, pm)
  }
  return false
}

/** True when the package declares at least one dependency to install. */
function hasDependencies(pkg) {
  return ['dependencies', 'devDependencies', 'optionalDependencies'].some(
    (field) => pkg && typeof pkg[field] === 'object' && pkg[field] !== null && Object.keys(pkg[field]).length > 0
  )
}

module.exports = {
  exists,
  hasDependencies,
  readText,
  readPackageJson,
  ancestorDirs,
  detectPackageManager,
  checkDependenciesInstalled,
}

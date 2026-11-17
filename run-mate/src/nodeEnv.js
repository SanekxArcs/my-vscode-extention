const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { which, quoteArg } = require('./shells')
const { ancestorDirs, readText, readPackageJson } = require('./packageUtils')

/**
 * Node version handling: which version a project asks for, which version
 * managers are on this machine, what they have installed, and how to switch
 * in each shell. No vscode dependency.
 */

const MANAGER_LABELS = {
  fnm: 'fnm',
  nvm: 'nvm',
  'nvm-windows': 'nvm for Windows',
  volta: 'Volta',
}

function firstMeaningfulLine(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const value = line.replace(/#.*$/, '').trim()
    if (value) return value
  }
  return null
}

/**
 * "20", "v20.11", "20.11.1" -> { kind: 'version', parts: [20, 11, 1] }
 * "lts/*", "node", "lts/iron" -> { kind: 'alias' }
 */
function parseSpec(raw) {
  const text = String(raw).trim()
  const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.exec(text)
  if (!m) return { raw: text, kind: 'alias', parts: [] }
  const parts = []
  for (const piece of [m[1], m[2], m[3]]) {
    if (piece === undefined || !/^\d+$/.test(piece)) break
    parts.push(Number(piece))
  }
  return { raw: text, kind: 'version', parts }
}

function parseVersion(text) {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(String(text))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True when a concrete version ("v20.11.1") satisfies a spec ("20"). */
function versionMatches(spec, actual) {
  if (!spec || spec.kind !== 'version') return false
  const parsed = parseVersion(actual)
  if (!parsed) return false
  return spec.parts.every((part, index) => parsed[index] === part)
}

function compareVersions(a, b) {
  const pa = parseVersion(a) || [0, 0, 0]
  const pb = parseVersion(b) || [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

/** Highest installed version that satisfies the spec, or null. */
function bestInstalledMatch(spec, versions) {
  const matches = (versions || []).filter((v) => versionMatches(spec, v))
  if (!matches.length) return null
  return matches.sort(compareVersions).pop()
}

/**
 * Finds the Node version a project asks for. Looks in the project folder and
 * then in its parents up to the workspace folder, so a nested package uses
 * the `.nvmrc` of the repository root.
 */
async function findNodeSpec(projectDir, stopDir) {
  for (const dir of ancestorDirs(projectDir, stopDir)) {
    for (const file of ['.nvmrc', '.node-version']) {
      const text = await readText(path.join(dir, file))
      const value = text === null ? null : firstMeaningfulLine(text)
      if (value) return { ...parseSpec(value), source: file, dir }
    }

    const toolVersions = await readText(path.join(dir, '.tool-versions'))
    if (toolVersions !== null) {
      const m = /^\s*nodejs\s+(\S+)/m.exec(toolVersions)
      if (m) return { ...parseSpec(m[1]), source: '.tool-versions', dir }
    }

    const pkg = await readPackageJson(path.join(dir, 'package.json'))
    const volta = pkg?.volta?.node
    if (typeof volta === 'string' && volta.trim()) {
      return { ...parseSpec(volta), source: 'package.json (volta.node)', dir }
    }
  }
  return null
}

/**
 * The `engines.node` range of the nearest package.json that has one
 * (project folder first, then its parents up to the workspace folder).
 */
async function findEnginesRange(projectDir, stopDir) {
  for (const dir of ancestorDirs(projectDir, stopDir)) {
    const pkg = await readPackageJson(path.join(dir, 'package.json'))
    const range = pkg?.engines?.node
    if (typeof range === 'string' && range.trim()) return { range: range.trim(), dir }
  }
  return null
}

function findNvmScript(env, home) {
  const candidates = []
  if (env.NVM_DIR) candidates.push(path.join(env.NVM_DIR, 'nvm.sh'))
  candidates.push(
    path.join(home, '.nvm', 'nvm.sh'),
    '/opt/homebrew/opt/nvm/nvm.sh',
    '/usr/local/opt/nvm/nvm.sh',
    '/usr/share/nvm/nvm.sh'
  )
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return null
}

/** Version managers present on this machine, in RunMate's order of preference. */
function detectManagers(env = process.env, platform = process.platform, home = os.homedir()) {
  const managers = []

  if (platform === 'win32') {
    let bin = null
    if (env.NVM_HOME) {
      const candidate = path.join(env.NVM_HOME, 'nvm.exe')
      try {
        if (fs.statSync(candidate).isFile()) bin = candidate
      } catch {}
    }
    bin = bin || which('nvm', env, platform)
    if (bin) managers.push({ id: 'nvm-windows', bin, home: env.NVM_HOME || path.dirname(bin) })
  } else {
    const script = findNvmScript(env, home)
    if (script) {
      managers.push({ id: 'nvm', script, home: env.NVM_DIR || path.join(home, '.nvm') })
    }
  }

  const fnm = which('fnm', env, platform)
  if (fnm) managers.push({ id: 'fnm', bin: fnm })

  const volta = which('volta', env, platform)
  if (volta) managers.push({ id: 'volta', bin: volta })

  return managers
}

function run(file, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : String(stdout))
    })
  })
}

/**
 * True when a tool can really be started. Volta puts shims for pnpm and yarn
 * on PATH even when those tools are not installed, so for a file next to the
 * `volta` binary the only reliable answer is to run it.
 */
async function isUsableBinary(name, env = process.env, platform = process.platform) {
  const file = which(name, env, platform)
  if (!file) return false
  const volta = which('volta', env, platform)
  if (!volta || path.dirname(volta) !== path.dirname(file)) return true
  return (await run(file, ['--version'])) !== null
}

/** Version of the `node` on PATH ("v22.19.0"), or null when there is none. */
async function getCurrentNodeVersion(env = process.env, platform = process.platform) {
  const node = which('node', env, platform)
  if (!node) return null
  const out = await run(node, ['--version'])
  return out ? out.trim() : null
}

async function listDirVersions(dir) {
  try {
    const names = await fs.promises.readdir(dir)
    return names.filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
  } catch {
    return []
  }
}

/**
 * Versions a manager has installed. Returns null when that cannot be known
 * (Volta downloads what it needs by itself).
 */
async function getInstalledVersions(manager) {
  switch (manager.id) {
    case 'nvm':
      return listDirVersions(path.join(manager.home, 'versions', 'node'))
    case 'nvm-windows':
      return listDirVersions(manager.home)
    case 'fnm': {
      const out = await run(manager.bin, ['list'])
      return out === null ? null : out.match(/v\d+\.\d+\.\d+/g) || []
    }
    default:
      return null
  }
}

function fnmEnvCommand(shell) {
  switch (shell.family) {
    case 'powershell':
      // No --shell: fnm infers PowerShell, and the flag value was renamed
      // between fnm releases ("power-shell" -> "powershell").
      return 'fnm env | Out-String | Invoke-Expression'
    case 'cmd':
      // Parentheses keep the following `&&` out of the DO body; `tokens^=*`
      // avoids double quotes inside `cmd /c "..."`.
      return "(FOR /f tokens^=* %z IN ('fnm env --shell cmd') DO @CALL %z)"
    case 'fish':
      return 'fnm env --shell fish | source'
    default:
      return `eval "$(fnm env --shell ${shell.kind === 'zsh' ? 'zsh' : 'bash'})"`
  }
}

function aliasFor(managerId, raw) {
  const lower = raw.toLowerCase()
  if (managerId === 'nvm-windows' || managerId === 'volta') {
    if (lower === 'lts/*' || lower === 'lts') return 'lts'
    if (['node', 'stable', 'latest', 'current'].includes(lower)) return 'latest'
  }
  return raw
}

/**
 * Commands that put the requested Node version on PATH for one task.
 *
 * Returns `{ setup, wrap }`:
 *  - `setup`: commands to run before the script
 *  - `wrap`: rewrites each package manager command (Volta only)
 *
 * nvm.sh can only be sourced by bash / zsh / sh; the caller picks such a
 * shell before asking for an nvm activation.
 */
function buildActivation(manager, shell, spec, options = {}) {
  const { install = false, resolvedVersion = null } = options
  const q = (value) => quoteArg(shell.family, value)
  const identity = (command) => command

  switch (manager.id) {
    case 'fnm': {
      const version = q(spec.raw)
      return {
        setup: [
          fnmEnvCommand(shell),
          install ? `fnm use ${version} --install-if-missing` : `fnm use ${version}`,
        ],
        wrap: identity,
      }
    }

    case 'nvm': {
      const version = q(spec.raw)
      return {
        // `nvm install` also switches to the version it installed.
        setup: [`. ${q(manager.script)}`, install ? `nvm install ${version}` : `nvm use ${version}`],
        wrap: identity,
      }
    }

    case 'nvm-windows': {
      // nvm for Windows does not read .nvmrc and older releases need a full
      // version, so an installed match is passed as an exact "20.11.1".
      const wanted = aliasFor('nvm-windows', spec.raw).replace(/^v/i, '')
      const exact = resolvedVersion ? resolvedVersion.replace(/^v/i, '') : wanted
      const setup = install ? [`nvm install ${q(wanted)}`, `nvm use ${q(wanted)}`] : [`nvm use ${q(exact)}`]
      return { setup, wrap: identity }
    }

    case 'volta': {
      const version = q(aliasFor('volta', spec.raw).replace(/^v/i, ''))
      return { setup: [], wrap: (command) => `volta run --node ${version} ${command}` }
    }

    default:
      return { setup: [], wrap: identity }
  }
}

/** The command that installs fnm, shown to the user before it runs. */
function getManagerInstallCommand(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    return which('winget', env, platform) ? 'winget install --id Schniz.fnm -e' : null
  }
  if (platform === 'darwin' && which('brew', env, platform)) return 'brew install fnm'
  if (which('curl', env, platform)) return 'curl -fsSL https://fnm.vercel.app/install | bash'
  return null
}

module.exports = {
  MANAGER_LABELS,
  parseSpec,
  versionMatches,
  bestInstalledMatch,
  findNodeSpec,
  findEnginesRange,
  compareVersions,
  detectManagers,
  getCurrentNodeVersion,
  isUsableBinary,
  getInstalledVersions,
  buildActivation,
  getManagerInstallCommand,
}

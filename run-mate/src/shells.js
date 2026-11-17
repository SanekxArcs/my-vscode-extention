const fs = require('fs')
const path = require('path')

/**
 * Shell knowledge, free of any vscode dependency so it can be unit-tested.
 *
 * RunMate never relies on "whatever shell the task happens to get": it always
 * resolves a concrete executable, so the command line it generates is written
 * in the syntax of the shell that will actually run it.
 */

const SHELL_LABELS = {
  pwsh: 'PowerShell 7',
  powershell: 'Windows PowerShell',
  cmd: 'Command Prompt',
  gitbash: 'Git Bash',
  bash: 'bash',
  zsh: 'zsh',
  fish: 'fish',
  sh: 'sh',
}

/** Syntax family of each shell kind. */
const FAMILY = {
  pwsh: 'powershell',
  powershell: 'powershell',
  cmd: 'cmd',
  gitbash: 'posix',
  bash: 'posix',
  zsh: 'posix',
  sh: 'posix',
  fish: 'fish',
}

const SHELL_ARGS = {
  pwsh: ['-Command'],
  powershell: ['-Command'],
  cmd: ['/d', '/c'],
  gitbash: ['-c'],
  bash: ['-c'],
  zsh: ['-c'],
  sh: ['-c'],
  fish: ['-c'],
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function getEnv(env, name) {
  if (env[name] !== undefined) return env[name]
  // Windows env names are case-insensitive, but a plain object copy is not.
  const lower = name.toLowerCase()
  const key = Object.keys(env).find((k) => k.toLowerCase() === lower)
  return key ? env[key] : undefined
}

/** Finds an executable on PATH. Returns the full path or null. */
function which(name, env = process.env, platform = process.platform) {
  const dirs = String(getEnv(env, 'PATH') || '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean)
  const exts =
    platform === 'win32'
      ? String(getEnv(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
      : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase())
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

/** Maps a shell executable path to a shell kind, or null when unknown. */
function classifyShell(shellPath, platform = process.platform) {
  if (!shellPath) return null
  const normalized = String(shellPath).replace(/\\/g, '/').toLowerCase()
  const base = normalized.split('/').pop().replace(/\.exe$/, '')
  switch (base) {
    case 'pwsh':
      return 'pwsh'
    case 'powershell':
      return 'powershell'
    case 'cmd':
      return 'cmd'
    case 'bash':
      if (platform !== 'win32') return 'bash'
      // System32\bash.exe and the WindowsApps alias are WSL launchers: they
      // cannot take a Windows cwd, so they are not treated as Git Bash.
      if (normalized.includes('/system32/') || normalized.includes('/windowsapps/')) return null
      return 'gitbash'
    case 'zsh':
      return 'zsh'
    case 'fish':
      return 'fish'
    case 'sh':
    case 'dash':
    case 'ash':
      return platform === 'win32' ? 'gitbash' : 'sh'
    default:
      return null
  }
}

function findGitBash(env = process.env) {
  const candidates = []
  const roots = [
    getEnv(env, 'ProgramFiles'),
    getEnv(env, 'ProgramW6432'),
    getEnv(env, 'ProgramFiles(x86)'),
  ].filter(Boolean)
  for (const root of roots) candidates.push(path.join(root, 'Git', 'bin', 'bash.exe'))
  const local = getEnv(env, 'LOCALAPPDATA')
  if (local) candidates.push(path.join(local, 'Programs', 'Git', 'bin', 'bash.exe'))

  // ...\Git\cmd\git.exe  ->  ...\Git\bin\bash.exe
  const git = which('git', env, 'win32')
  if (git) candidates.push(path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe'))

  return candidates.find(isFile) || null
}

/** Locates the executable for a shell kind. Returns null when not installed. */
function findShellExecutable(kind, env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    switch (kind) {
      case 'pwsh':
        return which('pwsh', env, platform)
      case 'powershell':
        return which('powershell', env, platform)
      case 'cmd':
        return getEnv(env, 'ComSpec') || which('cmd', env, platform)
      case 'gitbash':
        return findGitBash(env)
      default:
        return null
    }
  }
  if (kind === 'bash' || kind === 'zsh' || kind === 'fish' || kind === 'sh') {
    return which(kind, env, platform) || (kind === 'sh' ? '/bin/sh' : null)
  }
  if (kind === 'pwsh') return which('pwsh', env, platform)
  return null
}

function kindsForPlatform(platform = process.platform) {
  return platform === 'win32'
    ? ['pwsh', 'powershell', 'cmd', 'gitbash']
    : ['bash', 'zsh', 'fish', 'sh', 'pwsh']
}

function fallbackShell(env, platform) {
  if (platform === 'win32') {
    return { kind: 'cmd', executable: getEnv(env, 'ComSpec') || 'cmd.exe' }
  }
  return { kind: 'sh', executable: '/bin/sh' }
}

function describe(kind, executable, isDefault) {
  return {
    kind,
    executable,
    args: SHELL_ARGS[kind],
    family: FAMILY[kind],
    label: SHELL_LABELS[kind],
    isDefault,
  }
}

/**
 * Turns a setting value ("default", "pwsh", "gitbash", ...) into a concrete
 * shell. `defaultShellPath` is vscode.env.shell.
 *
 * An unknown default shell (nushell, a WSL launcher, ...) falls back to
 * cmd.exe on Windows and /bin/sh elsewhere: package manager commands run the
 * same there, and RunMate knows how to write a command line for them.
 */
function resolveShell(choice, defaultShellPath, env = process.env, platform = process.platform) {
  if (choice && choice !== 'default') {
    const executable = findShellExecutable(choice, env, platform)
    if (executable && FAMILY[choice]) return describe(choice, executable, false)
  }
  const kind = classifyShell(defaultShellPath, platform)
  if (kind) return describe(kind, defaultShellPath, true)
  const fallback = fallbackShell(env, platform)
  return describe(fallback.kind, fallback.executable, true)
}

/** Shells that are actually installed, for the "Run in..." picker. */
function listShells(defaultShellPath, env = process.env, platform = process.platform) {
  const def = resolveShell('default', defaultShellPath, env, platform)
  const result = [{ id: 'default', label: `Default (${def.label})`, detail: def.executable }]
  for (const kind of kindsForPlatform(platform)) {
    const executable = findShellExecutable(kind, env, platform)
    if (executable) result.push({ id: kind, label: SHELL_LABELS[kind], detail: executable })
  }
  return result
}

/** Quotes one argument for the given syntax family. */
function quoteArg(family, value) {
  const text = String(value)
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text
  switch (family) {
    case 'powershell':
      return `'${text.replace(/'/g, "''")}'`
    case 'cmd':
      return `"${text.replace(/"/g, '\\"')}"`
    case 'fish':
      return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
    default:
      return `'${text.replace(/'/g, `'\\''`)}'`
  }
}

/**
 * Joins commands so that each one runs only if the previous one succeeded.
 *
 * Windows PowerShell 5.1 has no `&&`, so PowerShell gets nested `if ($?)`
 * blocks, which behave the same in 5.1 and 7. The trailing `exit` makes the
 * task report the real exit code of the command that failed.
 */
function chainCommands(family, segments) {
  const parts = segments.filter(Boolean)
  if (parts.length === 0) return ''
  if (family !== 'powershell') return parts.join(' && ')
  const nested = parts.reduceRight((rest, part) => (rest ? `${part}; if ($?) { ${rest} }` : part), '')
  return `${nested}; exit $LASTEXITCODE`
}

module.exports = {
  SHELL_LABELS,
  which,
  classifyShell,
  findGitBash,
  findShellExecutable,
  resolveShell,
  listShells,
  quoteArg,
  chainCommands,
}

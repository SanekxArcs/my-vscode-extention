const vscode = require('vscode')
const net = require('net')
const { execFile } = require('child_process')

/** Dev servers that listen on a well-known port when none is given. */
const KNOWN_SERVERS = [
  [/\bnext\s+(dev|start)\b/, 3000, 'Next.js'],
  [/\bnuxi?\s+(dev|preview)\b/, 3000, 'Nuxt'],
  [/\breact-scripts\s+start\b/, 3000, 'Create React App'],
  [/\bvite\s+preview\b/, 4173, 'Vite preview'],
  [/\bvite(?![-\w])(?!\s+(build|optimize))/, 5173, 'Vite'],
  [/\bastro\s+(dev|preview)\b/, 4321, 'Astro'],
  [/\bng\s+serve\b/, 4200, 'Angular'],
  [/\bwebpack(-dev-server|\s+serve)\b/, 8080, 'webpack dev server'],
  [/\bvue-cli-service\s+serve\b/, 8080, 'Vue CLI'],
  [/\b(storybook\s+dev|start-storybook)\b/, 6006, 'Storybook'],
  [/\bgatsby\s+develop\b/, 8000, 'Gatsby'],
  [/\bexpo\s+start\b/, 8081, 'Expo'],
]

const EXPLICIT_PORT = /(?:--port[=\s]+|(?:^|\s)-p\s+|\bPORT=)(\d{2,5})(?!\d)/

function validPort(value) {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

function explicitPort(text) {
  const match = EXPLICIT_PORT.exec(text || '')
  return match ? validPort(match[1]) : null
}

/**
 * Works out which port a script is going to listen on, from the most
 * certain source to the least. Returns `{ port, source }` or null when
 * there is nothing to go on.
 */
function guessPort(entry, { args = '', env = null, envFile = '', overrides = {} } = {}) {
  const override = overrides && validPort(overrides[entry.script] ?? overrides[entry.name])
  if (override) return { port: override, source: 'the "scriptPorts" setting' }

  const fromArgs = explicitPort(args)
  if (fromArgs) return { port: fromArgs, source: 'the arguments of this run' }

  const fromCommand = explicitPort(entry.command)
  if (fromCommand) return { port: fromCommand, source: 'the command of the script' }

  const fromEnv = env && validPort(env.PORT)
  if (fromEnv) return { port: fromEnv, source: `PORT in ${envFile || 'the env file'}` }

  for (const [pattern, port, label] of KNOWN_SERVERS) {
    if (pattern.test(entry.command || '')) return { port, source: `the usual port of ${label}` }
  }
  return null
}

function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(400, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** True when something accepts connections on this port on this machine. */
async function isPortBusy(port) {
  const results = await Promise.all([canConnect(port, '127.0.0.1'), canConnect(port, '::1')])
  return results.some(Boolean)
}

async function waitForFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!(await isPortBusy(port))) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 5000, encoding: 'utf8' }, (error, stdout) =>
      resolve(error && !stdout ? null : String(stdout))
    )
  })
}

async function findOwnerWindows(port) {
  const out = await run('netstat', ['-ano'])
  if (!out) return null
  for (const line of out.split(/\r?\n/)) {
    // Proto, local address, remote address, state, PID. The state is
    // translated on non-English Windows, so a listener is recognised by
    // its remote address instead.
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5 || cols[0] !== 'TCP') continue
    if (!cols[1].endsWith(`:${port}`) || !/^(0\.0\.0\.0|\[::\]):0$/.test(cols[2])) continue
    const pid = Number(cols[cols.length - 1])
    if (!pid) continue
    const task = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
    const name = task && /^"([^"]+)"/.exec(task.trim())
    return { pid, name: name ? name[1] : null }
  }
  return null
}

async function findOwnerPosix(port) {
  const lsof = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'])
  const pid = lsof && /^p(\d+)/m.exec(lsof)
  if (pid) {
    const name = /^c(.+)$/m.exec(lsof)
    return { pid: Number(pid[1]), name: name ? name[1] : null }
  }
  const ss = await run('ss', ['-Hltnp', `sport = :${port}`])
  const fromSs = ss && /users:\(\("([^"]+)",pid=(\d+)/.exec(ss)
  return fromSs ? { pid: Number(fromSs[2]), name: fromSs[1] } : null
}

/** The process that listens on a port: `{ pid, name }`, or null when it cannot be told. */
function findOwner(port, platform = process.platform) {
  return platform === 'win32' ? findOwnerWindows(port) : findOwnerPosix(port)
}

/** Stops a process (and on Windows its children). */
async function killProcess(pid, platform = process.platform) {
  if (platform === 'win32') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F'])
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {}
}

function forceKill(pid, platform = process.platform) {
  if (platform === 'win32') return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
}

/**
 * Before a run: if the port the script is about to use is taken, say who
 * holds it and offer to stop that program.
 *
 * `waitMs` gives a script that RunMate has just stopped time to let go of
 * the port. Returns false when the run should not start.
 */
async function ensurePortFree({ entry, project, args, env, envFile, cfg, waitMs = 0 }) {
  if (!cfg.get('checkPorts', true)) return true
  const guess = guessPort(entry, { args, env, envFile, overrides: cfg.get('scriptPorts', {}) })
  if (!guess) return true
  const { port, source } = guess

  if (!(await isPortBusy(port))) return true
  if (waitMs && (await waitForFree(port, waitMs))) return true

  const owner = await findOwner(port)
  // Never offer to stop the system itself or the editor.
  const canStop = owner && owner.pid > 4 && owner.pid !== process.pid && owner.pid !== process.ppid
  const who = owner ? `${owner.name || 'a program'} (process ${owner.pid})` : 'another program'
  const stopButton = `Stop ${(owner && owner.name) || 'it'} and run`
  const runButton = 'Run anyway'

  const pick = await vscode.window.showWarningMessage(
    `Port ${port} is already in use`,
    {
      modal: true,
      detail:
        `'${entry.name}' in ${project.name} is expected to start on port ${port} (${source}).\n` +
        `That port is taken by ${who}.\n\n` +
        'Wrong port? Set the right one in the "Script Ports" setting, or turn "Check Ports" off.',
    },
    ...(canStop ? [stopButton, runButton] : [runButton])
  )
  if (!pick) return false
  if (pick === runButton) return true

  await killProcess(owner.pid)
  if (await waitForFree(port, 3000)) return true
  forceKill(owner.pid)
  if (await waitForFree(port, 3000)) return true

  vscode.window.showErrorMessage(
    `RunMate: could not free port ${port}. ${who} is still running; stop it yourself and run the script again.`
  )
  return false
}

module.exports = { guessPort, isPortBusy, waitForFree, findOwner, killProcess, ensurePortFree }

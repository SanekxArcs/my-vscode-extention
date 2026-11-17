const vscode = require('vscode')
const path = require('path')
const { which, resolveShell, quoteArg, chainCommands } = require('./shells')
const {
  detectPackageManager,
  checkDependenciesInstalled,
  hasDependencies,
  readPackageJson,
} = require('./packageUtils')
const {
  MANAGER_LABELS,
  parseSpec,
  versionMatches,
  bestInstalledMatch,
  compareVersions,
  findNodeSpec,
  findEnginesRange,
  detectManagers,
  getCurrentNodeVersion,
  isUsableBinary,
  getInstalledVersions,
  buildActivation,
  getManagerInstallCommand,
} = require('./nodeEnv')
const { satisfies, suggestMajor } = require('./semverLite')

const PM_LABELS = { npm: 'npm', pnpm: 'pnpm', yarn: 'Yarn', 'yarn-berry': 'Yarn', bun: 'Bun' }

/** Tools that run the scripts which do not come from package.json. */
const TOOLS = {
  deno: {
    label: 'Deno',
    binary: 'deno',
    command: (name) => `deno task ${name}`,
    guide: 'https://docs.deno.com/runtime/getting_started/installation/',
  },
  make: { label: 'make', binary: 'make', command: (name) => `make ${name}`, guide: null },
  just: {
    label: 'just',
    binary: 'just',
    command: (name) => `just ${name}`,
    guide: 'https://just.systems/man/en/packages.html',
  },
}

const short = (version) => String(version).replace(/^v/, '')

/** Modal question. Returns the chosen button label, or undefined on cancel. */
function ask(message, detail, ...buttons) {
  return vscode.window.showWarningMessage(message, { modal: true, detail }, ...buttons)
}

function filterManagers(managers, setting) {
  if (setting === 'auto') return managers
  if (setting === 'nvm') return managers.filter((m) => m.id === 'nvm' || m.id === 'nvm-windows')
  return managers.filter((m) => m.id === setting)
}

/** Runs the fnm installer in a terminal and tells the user what comes next. */
async function installVersionManager(command, shell, folder) {
  const task = new vscode.Task(
    { type: 'run-mate-script-runner', script: '__install-fnm__' },
    folder,
    'install fnm',
    'RunMate',
    new vscode.ShellExecution(command, { executable: shell.executable, shellArgs: shell.args })
  )
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated }

  const execution = await vscode.tasks.executeTask(task)
  const listener = vscode.tasks.onDidEndTaskProcess((event) => {
    if (event.execution !== execution) return
    listener.dispose()
    if (event.exitCode === 0) {
      vscode.window.showInformationMessage(
        'RunMate: fnm is installed. Restart VS Code so it is on PATH, then run the script again.'
      )
    } else {
      vscode.window.showErrorMessage('RunMate: installing fnm failed. See the terminal for details.')
    }
  })
}

/** Returns true to continue the run without a manager, false to stop. */
async function offerManagerInstall(message, detail, shell, project) {
  const command = getManagerInstallCommand()
  const installButton = 'Install fnm'
  const runButton = 'Run anyway'
  const buttons = command ? [installButton, runButton] : [runButton]
  const extra = command ? `\n\nRunMate can install fnm with:\n${command}` : ''
  const pick = await ask(message, detail + extra, ...buttons)
  if (pick === installButton) {
    await installVersionManager(command, shell, project.folder)
    return false
  }
  return pick === runButton
}

/**
 * The project has no version file but its package.json has `engines.node`,
 * and the active Node does not fit that range.
 *
 * If a manager already has a fitting version, RunMate switches to it without
 * asking (the newest one). Otherwise it asks.
 */
async function planForEngines({ project, range, current, managers, checks }) {
  let best = null
  for (const manager of managers) {
    const versions = (await getInstalledVersions(manager)) || []
    for (const version of versions) {
      if (satisfies(range, version) !== true) continue
      if (!best || compareVersions(version, best.version) > 0) best = { manager, version }
    }
  }
  if (best) {
    return {
      switchTo: { manager: best.manager, spec: parseSpec(best.version), install: false, resolvedVersion: best.version },
    }
  }
  if (!checks) return { switchTo: null }

  const major = managers.length ? suggestMajor(range) : null
  const installButton = `Install Node ${major} and run`
  const runButton = `Run with Node ${short(current)}`
  const pick = await ask(
    `"${project.name}" needs Node ${range}`,
    `That is what "engines.node" in its package.json says, and Node ${short(current)} is active.` +
      (managers.length ? '' : '\nNo Node version manager (fnm, nvm, Volta) was found to switch it.'),
    ...(major !== null ? [installButton, runButton] : [runButton])
  )
  if (!pick) return null
  if (pick === runButton) return { switchTo: null }
  return { switchTo: { manager: managers[0], spec: parseSpec(String(major)), install: true, resolvedVersion: null } }
}

/**
 * Works out how Node should be switched for this run, asking the user when
 * something has to be installed.
 *
 * Returns `{ switchTo }` (null: nothing to switch), or null when the user
 * cancelled.
 */
async function planNodeVersion({ project, shell, pm, checks, managerSetting }) {
  if (managerSetting === 'none') return { switchTo: null }

  const stopDir = project.folder.uri.fsPath
  const spec = await findNodeSpec(project.dir, stopDir)
  const current = await getCurrentNodeVersion()

  if (!spec) {
    const engines = current ? await findEnginesRange(project.dir, stopDir) : null
    if (engines && satisfies(engines.range, current) === false) {
      const managers = filterManagers(detectManagers(), managerSetting)
      return planForEngines({ project, range: engines.range, current, managers, checks })
    }

    // No version requested. Only step in when there is no Node at all.
    if (!checks || current || pm === 'bun' || detectManagers().length > 0) return { switchTo: null }
    const proceed = await offerManagerInstall(
      'Node.js was not found on PATH',
      `"${project.name}" needs Node.js to run its scripts, and no Node version manager is installed either.`,
      shell,
      project
    )
    return proceed ? { switchTo: null } : null
  }

  if (versionMatches(spec, current)) return { switchTo: null }

  const wanted = `Node ${spec.raw} (from ${spec.source})`
  const active = current ? `Node ${short(current)} is active` : 'no Node is on PATH'
  const managers = filterManagers(detectManagers(), managerSetting)

  if (!managers.length) {
    if (!checks) return { switchTo: null }
    const proceed = await offerManagerInstall(
      `"${project.name}" wants ${wanted}`,
      `Right now ${active}, and no Node version manager (fnm, nvm, Volta) was found to switch it.`,
      shell,
      project
    )
    return proceed ? { switchTo: null } : null
  }

  // Prefer a manager that already has a matching version.
  let chosen = null
  let resolvedVersion = null
  const installed = new Map()
  for (const manager of managers) {
    const versions = await getInstalledVersions(manager)
    installed.set(manager, versions)
    const match = bestInstalledMatch(spec, versions)
    if (match) {
      chosen = manager
      resolvedVersion = match
      break
    }
  }

  let install = false
  if (!chosen) {
    chosen = managers[0]
    const versions = installed.get(chosen)
    const knownMissing = spec.kind === 'version' && Array.isArray(versions)
    if (knownMissing && checks) {
      const installButton = `Install Node ${spec.raw} and run`
      const runButton = current ? `Run with Node ${short(current)}` : 'Run anyway'
      const pick = await ask(
        `"${project.name}" wants ${wanted}`,
        `${MANAGER_LABELS[chosen.id]} does not have that version installed (${active}).`,
        installButton,
        runButton
      )
      if (!pick) return null
      if (pick === runButton) return { switchTo: null }
      install = true
    }
  }

  return { switchTo: { manager: chosen, spec, install, resolvedVersion } }
}

/**
 * Checks the package manager binary. Returns `{ command, installSegment }`,
 * or null when the user cancelled.
 */
async function planPackageManager({ pm, checks, pathWillChange }) {
  const hasCorepack = Boolean(which('corepack'))
  let command = pm
  let binary = pm
  if (pm === 'yarn-berry') {
    // Berry is normally reached through corepack, which newer Node releases
    // no longer ship; fall back to a plain `yarn` then.
    const useCorepack = hasCorepack || !which('yarn')
    command = useCorepack ? 'corepack yarn' : 'yarn'
    binary = useCorepack ? 'corepack' : 'yarn'
  }

  // After a Node switch PATH is different (global packages are per version),
  // so a lookup from here would give a wrong answer.
  if (!checks || pathWillChange || (await isUsableBinary(binary))) return { command, installSegment: null }

  const label = PM_LABELS[pm]
  const packageName = pm === 'yarn-berry' ? 'yarn' : pm
  const canInstall = pm !== 'npm' && Boolean(which('npm'))
  const installCommand = `npm install -g ${packageName}`
  const installButton = `Install ${label} and run`
  const runButton = 'Run anyway'
  const pick = await ask(
    `${label} was not found on PATH`,
    canInstall
      ? `This project uses ${label}. RunMate can install it first with:\n${installCommand}`
      : `This project uses ${label}, and npm is not available to install it.`,
    ...(canInstall ? [installButton, runButton] : [runButton])
  )
  if (!pick) return null
  if (pick === installButton) {
    if (pm === 'yarn-berry') command = 'yarn'
    return { command, installSegment: installCommand }
  }
  return { command, installSegment: null }
}

/** Deno tasks, Makefile targets and just recipes: one tool, one command. */
async function planToolRun(entry, shell, checks, args) {
  const tool = TOOLS[entry.kind]
  if (checks && !which(tool.binary)) {
    const guideButton = 'Open install guide'
    const runButton = 'Run anyway'
    const pick = await ask(
      `${tool.label} was not found on PATH`,
      `"${entry.name}" is run with \`${tool.command(entry.name)}\`, and that program is not installed (or VS Code was started before it was).`,
      ...(tool.guide ? [guideButton, runButton] : [runButton])
    )
    if (pick === guideButton) await vscode.env.openExternal(vscode.Uri.parse(tool.guide))
    if (pick !== runButton) return null
  }
  const command = tool.command(quoteArg(shell.family, entry.name)) + (args ? ` ${args}` : '')
  return { shell, commandLine: chainCommands(shell.family, [command]) }
}

/**
 * Builds everything needed to start one entry: the shell, and a command
 * line written for that shell. Everything is detected now, at run time.
 *
 * `options.shell` overrides the shell setting for this run; `options.args`
 * is extra text passed to the script as it was typed.
 *
 * Returns null when the user cancelled one of the questions.
 */
async function planRun(project, entry, cfg, options = {}) {
  const checks = cfg.get('preflightChecks', true)
  const args = options.args ? String(options.args).trim() : ''
  let shell = resolveShell(options.shell || cfg.get('shell', 'default'), vscode.env.shell)

  if (entry.kind !== 'npm') return planToolRun(entry, shell, checks, args)

  const managerSetting = cfg.get('nodeVersionManager', 'auto')
  const { pm, rootDir } = await detectPackageManager(project.dir, project.folder.uri.fsPath)

  const nodePlan = await planNodeVersion({ project, shell, pm, checks, managerSetting })
  if (!nodePlan) return null

  let activation = null
  if (nodePlan.switchTo) {
    const { manager, spec, install, resolvedVersion } = nodePlan.switchTo
    if (manager.id === 'nvm' && shell.family !== 'posix') {
      // nvm.sh cannot be sourced from fish or PowerShell: run this one in bash.
      shell = resolveShell(which('bash') ? 'bash' : 'sh', '/bin/sh')
    }
    activation = buildActivation(manager, shell, spec, { install, resolvedVersion })
  }

  const pmPlan = await planPackageManager({ pm, checks, pathWillChange: Boolean(activation) })
  if (!pmPlan) return null

  let installDeps = cfg.get('alwaysInstallDependencies', false)
  if (!installDeps && cfg.get('autoInstallMissingDependencies', true)) {
    // A package without dependencies never gets a node_modules folder, so
    // "missing" would be true forever and every run would install again.
    const pkg = await readPackageJson(path.join(project.dir, 'package.json'))
    installDeps = hasDependencies(pkg) && !(await checkDependenciesInstalled(project.dir, pm, rootDir))
  }

  // npm needs "--" before arguments for the script; the others pass them on.
  const passArgs = args ? (pm === 'npm' ? ` -- ${args}` : ` ${args}`) : ''
  const wrap = activation ? activation.wrap : (command) => command
  const segments = [
    ...(activation ? activation.setup : []),
    pmPlan.installSegment ? wrap(pmPlan.installSegment) : null,
    installDeps ? wrap(`${pmPlan.command} install`) : null,
    wrap(`${pmPlan.command} run ${quoteArg(shell.family, entry.name)}${passArgs}`),
  ]

  return { shell, pm, commandLine: chainCommands(shell.family, segments) }
}

module.exports = { planRun }

const vscode = require('vscode')
const path = require('path')
const { parse } = require('jsonc-parser')
const { getConfig } = require('./config')

function getWorkspaceFolders() {
  return vscode.workspace.workspaceFolders ?? []
}

function slugify(id) {
  return String(id).replace(/[^a-z0-9\-_.:]/gi, '_')
}

async function readPackageJson(uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri)
    const text = Buffer.from(bytes).toString('utf8')
    return parse(text)
  } catch (error) {
    vscode.window.showErrorMessage(`Script Runner: invalid or unreadable package.json at ${uri.fsPath}`)
    return null
  }
}

async function detectPackageManager(root, pkg) {
  const pmField = pkg?.packageManager
  if (typeof pmField === 'string') {
    if (pmField.startsWith('pnpm')) return 'pnpm'
    if (pmField.startsWith('yarn')) return 'yarn'
    if (pmField.startsWith('bun')) return 'bun'
  }

  const exists = async (target) => {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(target))
      return true
    } catch {
      return false
    }
  }

  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn'
  if (await exists(path.join(root, 'bun.lockb'))) return 'bun'
  return 'npm'
}

function getRunCommand(pm, name) {
  switch (pm) {
    case 'pnpm':
      return `pnpm run ${name}`
    case 'yarn':
      return `yarn ${name}`
    case 'bun':
      return `bun run ${name}`
    default:
      return `npm run ${name}`
  }
}

function createTask(folder, pm, name) {
  const shellCmd = getRunCommand(pm, name)
  const execution = new vscode.ShellExecution(shellCmd, {
    cwd: folder.uri.fsPath,
    env: process.env,
  })

  const task = new vscode.Task(
    { type: 'scriptRunner', script: name, pm, folderPath: folder.uri.fsPath },
    folder,
    `run ${name}`,
    'Script Runner',
    execution,
    []
  )

  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    clear: false,
    panel: vscode.TaskPanelKind.Dedicated,
  }

  return task
}

async function terminateExistingIfNeeded(folder, name, pm) {
  const cfg = getConfig()
  const askBeforeKill = cfg.get('askBeforeKill', true)

  for (const execution of vscode.tasks.taskExecutions) {
    try {
      const def = execution.task.definition
      if (
        def?.type === 'scriptRunner' &&
        def.script === name &&
        def.pm === pm &&
        def.folderPath === folder.uri.fsPath
      ) {
        if (askBeforeKill) {
          const pick = await vscode.window.showWarningMessage(
            `Stop running script ${name} in ${folder.name}?`,
            { modal: true },
            'Stop'
          )
          if (pick !== 'Stop') return false
        }
        await execution.terminate()
      }
    } catch {
      // ignore race conditions
    }
  }

  return true
}

function registerScriptCommands(context) {
  let statusItems = []
  let registeredCommands = []

  const disposeAll = () => {
    for (const item of statusItems) {
      try { item.dispose() } catch {}
    }
    for (const command of registeredCommands) {
      try { command.dispose() } catch {}
    }
    statusItems = []
    registeredCommands = []
  }

  const buildButtons = async () => {
    disposeAll()

    const cfg = getConfig()
    const useDynamic = cfg.get('useDynamicScriptParsing', true)
    if (!useDynamic) return

    const workspaceMode = cfg.get('workspaceMode', 'first')
    const folders = getWorkspaceFolders()
    if (!folders.length) return

    const exclude = new Set(cfg.get('excludeScripts', []))
    const maxButtonsSetting = cfg.get('maxDynamicScriptButtons', 8)
    const maxButtons = Math.max(0, Number(maxButtonsSetting)) || 8

    const priorityMap = { dev: 3, start: 2, build: 1 }
    const collected = []

    const readScripts = async (folder) => {
      const pkgUri = vscode.Uri.joinPath(folder.uri, 'package.json')
      const pkg = await readPackageJson(pkgUri)
      if (!pkg) return []
      const pm = await detectPackageManager(folder.uri.fsPath, pkg)
      const entries = Object.entries(pkg.scripts || {})
        .filter(([name]) => !exclude.has(name))
        .sort((a, b) => (priorityMap[b[0]] || 0) - (priorityMap[a[0]] || 0) || a[0].localeCompare(b[0]))
      return entries.map(([name, command]) => ({ folder, pm, name, command }))
    }

    if (workspaceMode === 'first') {
      const folder = folders[0]
      collected.push(...await readScripts(folder))
    } else if (workspaceMode === 'all') {
      for (const folder of folders) {
        collected.push(...await readScripts(folder))
      }
    } else if (workspaceMode === 'pick') {
      const unions = new Map()
      for (const folder of folders) {
        const items = await readScripts(folder)
        for (const item of items) {
          if (!unions.has(item.name)) unions.set(item.name, [])
          unions.get(item.name).push(item)
        }
      }
      const merged = Array.from(unions.entries())
      merged.sort((a, b) => (priorityMap[b[0]] || 0) - (priorityMap[a[0]] || 0) || a[0].localeCompare(b[0]))
      for (const [name, variants] of merged) {
        collected.push({ name, command: variants[0].command, variants })
      }
    }

    const visible = collected.slice(0, maxButtons)
    const overflow = collected.slice(maxButtons)
    let priority = 110

    const makeCommandId = (entry) =>
      `scriptRunner.runScript.${slugify((entry.folder?.name || 'pick') + ':' + entry.name)}`

    const runEntry = async (entry) => {
      try {
        let folder = entry.folder
        let pm = entry.pm

        if (!folder && Array.isArray(entry.variants)) {
          const pick = await vscode.window.showQuickPick(
            entry.variants.map((variant) => ({
              label: variant.folder.name,
              description: variant.folder.uri.fsPath,
              variant,
            })),
            { placeHolder: `Select workspace folder for '${entry.name}'` }
          )
          if (!pick) return
          folder = pick.variant.folder
          pm = pick.variant.pm
        }

        if (!folder) return
        const shouldRun = await terminateExistingIfNeeded(folder, entry.name, pm)
        if (!shouldRun) return
        const task = createTask(folder, pm, entry.name)
        await vscode.tasks.executeTask(task)
      } catch (error) {
        vscode.window.showErrorMessage(`Script Runner: failed to run ${entry.name}. ${error.message}`)
      }
    }

    const createButton = (entry) => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority--)
      const icon = entry.name.includes('dev')
        ? '$(play)'
        : entry.name.includes('build')
          ? '$(gear)'
          : entry.name.includes('start')
            ? '$(rocket)'
            : '$(terminal)'
      const prefix = entry.folder ? `[${entry.folder.name}] ` : ''
      item.text = `${icon} ${prefix}${entry.name}`
      const tooltipFolder = entry.folder ? ` [${entry.folder.name}]` : ''
      item.tooltip = `Run script${tooltipFolder}: ${entry.name} -> ${entry.command}`

      const commandId = makeCommandId(entry)
      const disposable = vscode.commands.registerCommand(commandId, async () => runEntry(entry))
      registeredCommands.push(disposable)
      context.subscriptions.push(disposable)

      item.command = commandId
      item.show()
      statusItems.push(item)
      context.subscriptions.push(item)
    }

    visible.forEach(createButton)

    if (overflow.length > 0) {
      const overflowItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority--)
      overflowItem.text = `$(ellipsis) +${overflow.length}`
      overflowItem.tooltip = 'More scripts'

      const overflowCommandId = 'scriptRunner.runScript._overflow'
      const overflowCmd = vscode.commands.registerCommand(overflowCommandId, async () => {
        try {
          const pick = await vscode.window.showQuickPick(
            overflow.map((entry) => ({
              label: entry.name,
              description: entry.folder ? entry.folder.name : 'pick folder on run',
              entry,
            })),
            { placeHolder: 'Select a script to run' }
          )
          if (!pick) return
          await runEntry(pick.entry)
        } catch (error) {
          vscode.window.showErrorMessage(`Script Runner: failed to run script. ${error.message}`)
        }
      })
      registeredCommands.push(overflowCmd)
      context.subscriptions.push(overflowCmd)

      overflowItem.command = overflowCommandId
      overflowItem.show()
      statusItems.push(overflowItem)
      context.subscriptions.push(overflowItem)
    }
  }

  const applyVisibility = () => {
    const useDynamic = getConfig().get('useDynamicScriptParsing', true)
    if (useDynamic) {
      buildButtons()
    } else {
      disposeAll()
    }
  }

  const stopCommand = vscode.commands.registerCommand(
    'scriptRunner.stopRunningScripts',
    async () => {
      const executions = [...vscode.tasks.taskExecutions].filter(
        (execution) => execution.task.definition?.type === 'scriptRunner'
      )
      if (!executions.length) {
        vscode.window.showInformationMessage('Script Runner: no running scripts')
        return
      }
      const pick = await vscode.window.showWarningMessage(
        `Stop ${executions.length} running script(s)?`,
        { modal: true },
        'Stop All'
      )
      if (pick !== 'Stop All') return
      for (const execution of executions) {
        try {
          await execution.terminate()
        } catch {
          // ignore
        }
      }
    }
  )
  context.subscriptions.push(stopCommand)

  const watchPackageJson = () => {
    for (const folder of getWorkspaceFolders()) {
      const pattern = new vscode.RelativePattern(folder, 'package.json')
      const watcher = vscode.workspace.createFileSystemWatcher(pattern)
      watcher.onDidChange(() => applyVisibility())
      watcher.onDidCreate(() => applyVisibility())
      watcher.onDidDelete(() => applyVisibility())
      context.subscriptions.push(watcher)
    }
  }

  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration('scriptRunner.useDynamicScriptParsing') ||
      event.affectsConfiguration('scriptRunner.excludeScripts') ||
      event.affectsConfiguration('scriptRunner.maxDynamicScriptButtons') ||
      event.affectsConfiguration('scriptRunner.reuseTerminalForScripts') ||
      event.affectsConfiguration('scriptRunner.workspaceMode') ||
      event.affectsConfiguration('scriptRunner.askBeforeKill')
    ) {
      applyVisibility()
    }
  })
  context.subscriptions.push(configListener)

  watchPackageJson()
  applyVisibility()

  return { buildButtons, disposeAll }
}

module.exports = { registerScriptCommands }

const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { parse } = require('jsonc-parser')
const { getConfig } = require('./config')

function getWorkspaceFolders() { return vscode.workspace.workspaceFolders ?? [] }
function ensureWorkspaceFolder() { return getWorkspaceFolders()?.[0] }

function slugify(id) {
  return String(id).replace(/[^a-z0-9\-_.:]/gi, '_')
}

async function readPackageJson(uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri)
    const text = Buffer.from(bytes).toString('utf8')
    return parse(text)
  } catch (e) {
    vscode.window.showErrorMessage(`Invalid or unreadable package.json at ${uri.fsPath}`)
    return null
  }
}

async function detectPM(root, pkg) {
  const pmField = pkg?.packageManager
  if (typeof pmField === 'string') {
    if (pmField.startsWith('pnpm')) return 'pnpm'
    if (pmField.startsWith('yarn')) return 'yarn'
    if (pmField.startsWith('bun')) return 'bun'
  }
  const tryStat = async (p) => {
    try { await vscode.workspace.fs.stat(vscode.Uri.file(p)); return true } catch { return false }
  }
  if (await tryStat(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await tryStat(path.join(root, 'yarn.lock'))) return 'yarn'
  if (await tryStat(path.join(root, 'bun.lockb'))) return 'bun'
  return 'npm'
}

function runScriptCmd(pm, name) {
  switch (pm) {
    case 'pnpm': return `pnpm run ${name}`
    case 'yarn': return `yarn ${name}`
    case 'bun': return `bun run ${name}`
    default: return `npm run ${name}`
  }
}

function createScriptTask(folder, pm, name) {
  const shellCmd = runScriptCmd(pm, name)
  const exec = new vscode.ShellExecution(shellCmd, {
    cwd: folder.uri.fsPath,
    env: process.env,
  })
  const task = new vscode.Task(
    { type: 'runScript', script: name, pm, folderPath: folder.uri.fsPath },
    folder,
    `run ${name}`,
    'runScript',
    exec,
    []
  )
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: false, panel: vscode.TaskPanelKind.Dedicated }
  return task
}

async function terminateExistingIfNeeded(folder, name, pm) {
  const cfg = getConfig()
  const askBeforeKill = cfg.get('askBeforeKill', true)
  for (const exec of vscode.tasks.taskExecutions) {
    try {
      const def = exec.task.definition
      if (def?.type === 'runScript' && def.script === name && def.pm === pm && def.folderPath === folder.uri.fsPath) {
        if (askBeforeKill) {
          const pick = await vscode.window.showWarningMessage(`Stop running script ${name} in ${folder.name}?`, { modal: true }, 'Stop')
          if (pick !== 'Stop') return false
        }
        await exec.terminate()
      }
    } catch {}
  }
  return true
}

function registerScriptCommands(context) {
  // Only dynamic status bar buttons are supported. Static buttons removed.

  let dynamicButtons = []
  let dynamicCommands = []

  const clearDynamicButtons = () => {
    for (const item of dynamicButtons) { try { item.dispose() } catch {} }
    for (const cmd of dynamicCommands) { try { cmd.dispose() } catch {} }
    dynamicButtons = []
    dynamicCommands = []
  }

  const buildDynamicButtons = async () => {
    clearDynamicButtons()
    const cfg = getConfig()
    const useDynamic = cfg.get('useDynamicScriptParsing', true)
    if (!useDynamic) return

    const workspaceMode = cfg.get('workspaceMode', 'first')
    const folders = getWorkspaceFolders()
    if (!folders.length) return

  const exclude = new Set(cfg.get('excludeScripts', []))
  const maxCfg = cfg.get('maxDynamicScriptButtons', 8)
  const maxButtons = Math.max(0, Number(maxCfg)) || 8

    const priority = { dev: 3, start: 2, build: 1 }
    const isAll = workspaceMode === 'all'
    const isPick = workspaceMode === 'pick'

    const collect = []
    if (workspaceMode === 'first') {
      const f = folders[0]
      const pkgUri = vscode.Uri.joinPath(f.uri, 'package.json')
      const pkg = await readPackageJson(pkgUri)
      if (!pkg) return
  const pm = await detectPM(f.uri.fsPath, pkg)
      const scripts = Object.entries(pkg.scripts || {}).filter(([name]) => !exclude.has(name))
      scripts.sort((a, b) => (priority[b[0]] || 0) - (priority[a[0]] || 0) || a[0].localeCompare(b[0]))
      for (const [name, cmd] of scripts) collect.push({ folder: f, pm, name, cmd })
    } else if (isAll) {
      for (const f of folders) {
        const pkgUri = vscode.Uri.joinPath(f.uri, 'package.json')
        const pkg = await readPackageJson(pkgUri)
        if (!pkg) continue
  const pm = await detectPM(f.uri.fsPath, pkg)
        const scripts = Object.entries(pkg.scripts || {}).filter(([name]) => !exclude.has(name))
        scripts.sort((a, b) => (priority[b[0]] || 0) - (priority[a[0]] || 0) || a[0].localeCompare(b[0]))
        for (const [name, cmd] of scripts) collect.push({ folder: f, pm, name, cmd })
      }
    } else if (isPick) {
      // Union by script name across folders
      const union = new Map()
      for (const f of folders) {
        const pkgUri = vscode.Uri.joinPath(f.uri, 'package.json')
        const pkg = await readPackageJson(pkgUri)
        if (!pkg) continue
  const pm = await detectPM(f.uri.fsPath, pkg)
        for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
          if (exclude.has(name)) continue
          if (!union.has(name)) union.set(name, [])
          union.get(name).push({ folder: f, pm, name, cmd })
        }
      }
      const arr = Array.from(union.entries())
      arr.sort((a, b) => (priority[b[0]] || 0) - (priority[a[0]] || 0) || a[0].localeCompare(b[0]))
      for (const [name, variants] of arr) {
        // Represent as a single button; pick folder on run
        collect.push({ folder: null, pm: null, name, cmd: variants[0].cmd, variants })
      }
    }

    let basePriority = 110
    const visible = collect.slice(0, maxButtons)
    const overflow = collect.slice(maxButtons)

    const makeButtonText = (entry) => {
      const icon = entry.name.includes('dev') ? '$(play)' : entry.name.includes('build') ? '$(gear)' : entry.name.includes('start') ? '$(rocket)' : '$(terminal)'
      const prefix = isAll ? `[${entry.folder?.name}] ` : ''
      return `${icon} ${prefix}${entry.name}`
    }

    const runEntry = async (entry) => {
      try {
        let folder = entry.folder
        let pm = entry.pm
        if (isPick) {
          const pick = await vscode.window.showQuickPick(
            entry.variants.map(v => ({ label: v.folder.name, description: v.folder.uri.fsPath, v })),
            { placeHolder: `Select workspace folder for '${entry.name}'` }
          )
          if (!pick) return
          folder = pick.v.folder
          pm = pick.v.pm
        }
        if (!folder) return
        const ok = await terminateExistingIfNeeded(folder, entry.name, pm)
        if (!ok) return
        const task = createScriptTask(folder, pm, entry.name)
        await vscode.tasks.executeTask(task)
      } catch (error) {
        vscode.window.showErrorMessage(`Error running script ${entry.name}: ${error.message}`)
      }
    }

    for (const entry of visible) {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, basePriority--)
      item.text = makeButtonText(entry)
      const tooltipFolder = entry.folder ? ` [${entry.folder.name}]` : ''
      item.tooltip = `Run script${tooltipFolder}: ${entry.name} -> ${entry.cmd}`

      const commandId = `extension.runScript.${slugify((entry.folder?.name || 'pick') + ':' + entry.name)}`
      const disposableCmd = vscode.commands.registerCommand(commandId, async () => runEntry(entry))
      dynamicCommands.push(disposableCmd)
      context.subscriptions.push(disposableCmd)

      item.command = commandId
      item.show()
      dynamicButtons.push(item)
      context.subscriptions.push(item)
    }

    if (overflow.length > 0) {
      const overflowItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, basePriority--)
      overflowItem.text = `$(ellipsis) +${overflow.length}`
      overflowItem.tooltip = `More scripts`

      const overflowCommandId = `extension.runScript._overflow`
      const disposableOverflowCmd = vscode.commands.registerCommand(overflowCommandId, async () => {
        try {
          const picked = await vscode.window.showQuickPick(
            overflow.map((e) => ({ label: e.name, description: e.folder ? e.folder.name : 'pick folder on run', e })),
            { placeHolder: 'Select a script to run' }
          )
          if (!picked) return
          await runEntry(picked.e)
        } catch (error) {
          vscode.window.showErrorMessage(`Error running script: ${error.message}`)
        }
      })
      dynamicCommands.push(disposableOverflowCmd)
      context.subscriptions.push(disposableOverflowCmd)

      overflowItem.command = overflowCommandId
      overflowItem.show()
      dynamicButtons.push(overflowItem)
      context.subscriptions.push(overflowItem)
    }
  }

  const applyVisibility = () => {
    const useDynamic = getConfig().get('useDynamicScriptParsing', true)
    if (useDynamic) {
      buildDynamicButtons()
    } else {
      clearDynamicButtons()
    }
  }

  // Command: Stop running script(s)
  const stopAll = vscode.commands.registerCommand('extension.stopRunningScripts', async () => {
    const executions = [...vscode.tasks.taskExecutions].filter(e => e.task.definition?.type === 'runScript')
    if (!executions.length) { vscode.window.showInformationMessage('No running scripts'); return }
    const pick = await vscode.window.showWarningMessage(`Stop ${executions.length} running script(s)?`, { modal: true }, 'Stop All')
    if (pick !== 'Stop All') return
    for (const e of executions) { try { await e.terminate() } catch {} }
  })
  context.subscriptions.push(stopAll)

  // Watch package.json across all folders
  function watchPackageJson() {
    for (const folder of getWorkspaceFolders()) {
      const pattern = new vscode.RelativePattern(folder, 'package.json')
      const watcher = vscode.workspace.createFileSystemWatcher(pattern)
      watcher.onDidChange(() => applyVisibility())
      watcher.onDidCreate(() => applyVisibility())
      watcher.onDidDelete(() => applyVisibility())
      context.subscriptions.push(watcher)
    }
  }

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration('runScript.useDynamicScriptParsing') ||
      e.affectsConfiguration('runScript.excludeScripts') ||
      e.affectsConfiguration('runScript.maxDynamicScriptButtons') ||
      e.affectsConfiguration('runScript.reuseTerminalForScripts') ||
      e.affectsConfiguration('runScript.workspaceMode') ||
      e.affectsConfiguration('runScript.askBeforeKill')
    ) {
      applyVisibility()
    }
  })
  context.subscriptions.push(onConfigChange)

  watchPackageJson()
  applyVisibility()

  return { applyVisibility, buildDynamicButtons, clearDynamicButtons }
}

module.exports = { registerScriptCommands }

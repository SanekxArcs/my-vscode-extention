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
        vscode.window.showErrorMessage(
          `RunMate: invalid or unreadable package.json at ${uri.fsPath}`
        );
    return null
  }
}

async function checkNvmrcExists(root) {
  try {
    const nvmrcPath = path.join(root, ".nvmrc");
    await vscode.workspace.fs.stat(vscode.Uri.file(nvmrcPath));
    return true;
  } catch {
    return false;
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
  if (await exists(path.join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

function getRunCommand(pm, name, hasNvmrc = false) {
  let command = "";
  if (hasNvmrc) {
    command = ". ~/.nvm/nvm.sh && nvm use && ";
  }

  switch (pm) {
    case "pnpm":
      return command + `pnpm run ${name}`;
    case "yarn":
      return command + `yarn ${name}`;
    case "bun":
      return command + `bun run ${name}`;
    default:
      return command + `npm run ${name}`;
  }
}

function createTask(folder, pm, name, hasNvmrc = false) {
  const shellCmd = getRunCommand(pm, name, hasNvmrc);
  const execution = new vscode.ShellExecution(shellCmd, {
    cwd: folder.uri.fsPath,
    env: process.env,
  });

  const task = new vscode.Task(
    { type: "runmate", script: name, pm, folderPath: folder.uri.fsPath },
    folder,
    `run ${name}`,
    "RunMate",
    execution,
    []
  );

  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    clear: false,
    panel: vscode.TaskPanelKind.Dedicated,
  };

  return task;
}

async function terminateExistingIfNeeded(folder, name, pm) {
  const cfg = getConfig()
  const askBeforeKill = cfg.get('askBeforeKill', true)

  for (const execution of vscode.tasks.taskExecutions) {
    try {
      const def = execution.task.definition
      if (
        def?.type === "runmate" &&
        def.script === name &&
        def.pm === pm &&
        def.folderPath === folder.uri.fsPath
      ) {
        if (askBeforeKill) {
          const pick = await vscode.window.showWarningMessage(
            `Stop running script ${name} in ${folder.name}?`,
            { modal: true },
            "Stop"
          );
          if (pick !== "Stop") return false;
        }
        await execution.terminate();
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
  let lastCollected = []

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

    const scriptOrder = cfg.get('scriptOrder', ['dev', 'start', 'build', 'test', 'lint'])
    const priorityMap = new Map(scriptOrder.map((name, index) => [name, scriptOrder.length - index]))
    const collected = []

    const readScripts = async (folder) => {
      const pkgUri = vscode.Uri.joinPath(folder.uri, 'package.json')
      const pkg = await readPackageJson(pkgUri)
      if (!pkg) return []
      const pm = await detectPackageManager(folder.uri.fsPath, pkg)
      const hasNvmrc = await checkNvmrcExists(folder.uri.fsPath);
      const entries = Object.entries(pkg.scripts || {})
        .filter(([name]) => !exclude.has(name))
        .sort((a, b) => {
          const pA = priorityMap.get(a[0]) || 0
          const pB = priorityMap.get(b[0]) || 0
          if (pA !== pB) return pB - pA
          return a[0].localeCompare(b[0])
        })
      return entries.map(([name, command]) => ({
        folder,
        pm,
        name,
        command,
        hasNvmrc,
      }));
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
      merged.sort((a, b) => {
        const pA = priorityMap.get(a[0]) || 0
        const pB = priorityMap.get(b[0]) || 0
        if (pA !== pB) return pB - pA
        return a[0].localeCompare(b[0])
      })
      for (const [name, variants] of merged) {
        collected.push({ name, command: variants[0].command, variants })
      }
    }

    const visible = collected.slice(0, maxButtons)
    const overflow = collected.slice(maxButtons)
    let priority = 110

    lastCollected = collected

    const makeCommandId = (entry) =>
      `runmate.runScript.${slugify(
        (entry.folder?.name || "pick") + ":" + entry.name
      )}`;

    const runEntry = async (entry) => {
      try {
        let folder = entry.folder
        let pm = entry.pm
        let hasNvmrc = entry.hasNvmrc;

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
          hasNvmrc = pick.variant.hasNvmrc;
        }

        if (!folder) return
        const shouldRun = await terminateExistingIfNeeded(folder, entry.name, pm)
        if (!shouldRun) return
        const task = createTask(folder, pm, entry.name, hasNvmrc);
        await vscode.tasks.executeTask(task)
      } catch (error) {
        vscode.window.showErrorMessage(
          `RunMate: failed to run ${entry.name}. ${error.message}`
        );
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
      item.text = `${icon} ${entry.name}`
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

      const overflowCommandId = "runmate.runScript._overflow";
      const overflowCmd = vscode.commands.registerCommand(overflowCommandId, async () => {
        try {
          const pick = await vscode.window.showQuickPick(
            collected.map((entry) => ({
              label: entry.name,
              description: entry.folder ? entry.folder.name : 'pick folder on run',
              entry,
            })),
            { placeHolder: 'Select a script to run' }
          )
          if (!pick) return
          await runEntry(pick.entry)
        } catch (error) {
          vscode.window.showErrorMessage(
            `RunMate: failed to run script. ${error.message}`
          );
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
    "runmate.stopRunningScripts",
    async () => {
      const executions = [...vscode.tasks.taskExecutions].filter(
        (execution) => execution.task.definition?.type === "runmate"
      );
      if (!executions.length) {
        vscode.window.showInformationMessage("RunMate: no running scripts");
        return;
      }
      const pick = await vscode.window.showWarningMessage(
        `Stop ${executions.length} running script(s)?`,
        { modal: true },
        "Stop All"
      );
      if (pick !== "Stop All") return;
      for (const execution of executions) {
        try {
          await execution.terminate();
        } catch {
          // ignore
        }
      }
    }
  );
  context.subscriptions.push(stopCommand)

  const showAllScriptsCommand = vscode.commands.registerCommand(
    "runmate.showAllScripts",
    async () => {
      try {
        const pick = await vscode.window.showQuickPick(
          lastCollected.map((entry) => ({
            label: entry.name,
            description: entry.folder
              ? entry.folder.name
              : "pick folder on run",
            entry,
          })),
          { placeHolder: "Select a script to run" }
        );
        if (!pick) return;
        await runEntry(pick.entry);
      } catch (error) {
        vscode.window.showErrorMessage(
          `RunMate: failed to run script. ${error.message}`
        );
      }
    }
  );
  context.subscriptions.push(showAllScriptsCommand)

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
      event.affectsConfiguration("runmate.useDynamicScriptParsing") ||
      event.affectsConfiguration("runmate.excludeScripts") ||
      event.affectsConfiguration("runmate.maxDynamicScriptButtons") ||
      event.affectsConfiguration("runmate.reuseTerminalForScripts") ||
      event.affectsConfiguration("runmate.workspaceMode") ||
      event.affectsConfiguration("runmate.askBeforeKill")
    ) {
      applyVisibility();
    }
  })
  context.subscriptions.push(configListener)

  watchPackageJson()
  applyVisibility()

  return { buildButtons, disposeAll }
}

module.exports = { registerScriptCommands }

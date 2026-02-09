const vscode = require('vscode')
const { getConfig } = require('./config')
const {
  getWorkspaceFolders,
  readPackageJson,
  checkNvmrcExists,
  detectPackageManager
} = require('./packageUtils')
const {
  createTask,
  terminateExistingIfNeeded
} = require('./taskManager')
const { StatusBarProvider } = require('./statusBarProvider')

function registerScriptCommands(context) {
  let lastCollected = []
  let watchers = []
  let buildInProgress = false

  const statusBarProvider = new StatusBarProvider(context, (entry) => runEntry(entry))

  const runEntry = async (entry) => {
    try {
      let folder = entry.folder
      let pm = entry.pm
      let hasNvmrc = entry.hasNvmrc

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
        hasNvmrc = pick.variant.hasNvmrc
      }

      if (!folder) return
      const shouldRun = await terminateExistingIfNeeded(folder, entry.name, pm)
      if (!shouldRun) return

      const task = createTask(folder, pm, entry.name, hasNvmrc)
      await vscode.tasks.executeTask(task)
    } catch (error) {
      vscode.window.showErrorMessage(`RunMate: failed to run ${entry.name}. ${error.message}`)
    }
  }

  const buildButtons = async () => {
    if (buildInProgress) return
    buildInProgress = true

    try {
      statusBarProvider.disposeAll()

      const cfg = getConfig()
      if (!cfg.get('useDynamicScriptParsing', true)) {
        console.log('RunMate: dynamic script parsing is disabled in settings.');
        return
      }

      const folders = getWorkspaceFolders()
      if (!folders.length) {
        console.log('RunMate: no workspace folders found.');
        return
      }

      const workspaceMode = cfg.get('workspaceMode', 'first')
      const exclude = new Set(cfg.get('excludeScripts', []))
      const maxButtons = Math.max(0, Number(cfg.get('maxDynamicScriptButtons', 8))) || 8
      const scriptOrder = cfg.get('scriptOrder', ['dev', 'start', 'build', 'test', 'lint'])
      const priorityMap = new Map(scriptOrder.map((name, index) => [name, scriptOrder.length - index]))

      console.log(`RunMate: building buttons in '${workspaceMode}' mode for ${folders.length} folder(s)`);

      const collectFromFolder = async (folder) => {
        try {
          const pkgUri = vscode.Uri.joinPath(folder.uri, 'package.json')
          const pkg = await readPackageJson(pkgUri)
          if (!pkg) return []

          const pm = await detectPackageManager(folder.uri, pkg)
          const hasNvmrc = await checkNvmrcExists(folder.uri)
          const entries = Object.entries(pkg.scripts || {})
            .filter(([name]) => !exclude.has(name))
            .sort((a, b) => {
              const pA = priorityMap.get(a[0]) || 0
              const pB = priorityMap.get(b[0]) || 0
              if (pA !== pB) return pB - pA
              return a[0].localeCompare(b[0])
            })

          return entries.map(([name, command]) => ({
            folder, pm, name, command, hasNvmrc
          }))
        } catch (err) {
          console.error(`RunMate: error collecting from ${folder.name}:`, err);
          return [];
        }
      }

      let collected = []
      if (workspaceMode === 'all') {
        const results = await Promise.all(folders.map(collectFromFolder))
        results.forEach(items => collected.push(...items))
      } else if (workspaceMode === 'first') {
        collected = await collectFromFolder(folders[0])
      } else if (workspaceMode === 'pick') {
        const unions = new Map()
        const results = await Promise.all(folders.map(collectFromFolder))
        results.forEach(items => {
          items.forEach(item => {
            if (!unions.has(item.name)) unions.set(item.name, [])
            unions.get(item.name).push(item)
          })
        })
        const merged = Array.from(unions.entries()).sort((a, b) => {
          const pA = priorityMap.get(a[0]) || 0
          const pB = priorityMap.get(b[0]) || 0
          if (pA !== pB) return pB - pA
          return a[0].localeCompare(b[0])
        })
        collected = merged.map(([name, variants]) => ({
          name, command: variants[0].command, variants
        }))
      }

      console.log(`RunMate: found ${collected.length} total scripts.`);

      lastCollected = collected
      const visible = collected.slice(0, maxButtons)
      const overflow = collected.slice(maxButtons)

      let priority = 110
      visible.forEach(entry => statusBarProvider.createButton(entry, priority--))

      if (overflow.length > 0) {
        statusBarProvider.createOverflowButton(collected, priority)
      }
    } catch (error) {
      console.error('RunMate: error building buttons:', error);
    } finally {
      buildInProgress = false
    }
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('run-mate-script-runner.stopRunningScripts', async () => {
      const executions = vscode.tasks.taskExecutions.filter(e => e.task.definition?.type === 'run-mate-script-runner')
      if (!executions.length) {
        vscode.window.showInformationMessage("RunMate: no running scripts")
        return
      }
      const pick = await vscode.window.showWarningMessage(`Stop ${executions.length} running script(s)?`, { modal: true }, "Stop All")
      if (pick === "Stop All") {
        executions.forEach(e => e.terminate().catch(() => {}))
      }
    }),

    vscode.commands.registerCommand('run-mate-script-runner.showAllScripts', async () => {
      const pick = await vscode.window.showQuickPick(
        lastCollected.map(entry => ({
          label: entry.name,
          description: entry.folder ? entry.folder.name : "pick folder on run",
          entry
        })),
        { placeHolder: "Select a script to run" }
      )
      if (pick) runEntry(pick.entry)
    })
  )

  const applyVisibility = () => buildButtons()

  const watchPackageJson = () => {
    watchers.forEach(w => w.dispose())
    watchers = getWorkspaceFolders().map(folder => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, 'package.json'))
      watcher.onDidChange(applyVisibility)
      watcher.onDidCreate(applyVisibility)
      watcher.onDidDelete(applyVisibility)
      return watcher
    })
    watchers.forEach(w => context.subscriptions.push(w))
  }

  // Listeners
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("run-mate-script-runner")) applyVisibility()
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      watchPackageJson()
      applyVisibility()
    })
  )

  watchPackageJson()
  applyVisibility()

  context.subscriptions.push({ dispose: () => statusBarProvider.disposeAll() })

  return { buildButtons, disposeAll: () => statusBarProvider.disposeAll() }
}

module.exports = { registerScriptCommands }

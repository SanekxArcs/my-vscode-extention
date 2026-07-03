const vscode = require('vscode')
const { getConfig } = require('./config')
const {
  getWorkspaceFolders,
  readPackageJson,
  checkNvmrcExists,
  detectPackageManager,
  checkDependenciesInstalled
} = require('./packageUtils')
const {
  createTask
} = require('./taskManager')
const { StatusBarProvider } = require('./statusBarProvider')
const { makeFavoriteKey, getFavorites, toggleFavorite } = require('./favoritesManager')

function registerScriptCommands(context) {
  let lastCollected = []
  let watchers = []
  let buildInProgress = false

  const statusBarProvider = new StatusBarProvider(
    context,
    (entry) => runEntry(entry),
    (entry) => stopEntry(entry)
  )

  const stopEntry = async (entry) => {
    for (const execution of vscode.tasks.taskExecutions) {
      try {
        const def = execution.task.definition
        // For pick-mode entries entry.folder is null — match by name only
        const folderMatch = entry.folder
          ? def.folderPath === entry.folder.uri.fsPath
          : true
        if (
          def?.type === 'run-mate-script-runner' &&
          def.script === entry.name &&
          folderMatch
        ) {
          await execution.terminate()
        }
      } catch {}
    }
    // Update immediately; onDidEndTask will also fire but that's harmless
    statusBarProvider.setRunning(entry, false)
  }

  const runEntry = async (entry) => {
    try {
      const cfg = getConfig()
      let folder = entry.folder
      let pm = entry.pm
      let hasNvmrc = entry.hasNvmrc

      if (!folder && Array.isArray(entry.variants)) {
        if (entry.variants.length === 1) {
          folder = entry.variants[0].folder
          pm = entry.variants[0].pm
          hasNvmrc = entry.variants[0].hasNvmrc
        } else {
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
      }

      if (!folder) return

      const alwaysInstall = cfg.get('alwaysInstallDependencies', false)
      const autoInstallMissing = cfg.get('autoInstallMissingDependencies', true)

      let installFirst = alwaysInstall
      if (!installFirst && autoInstallMissing) {
        const depsInstalled = await checkDependenciesInstalled(folder.uri, pm)
        if (!depsInstalled) {
          installFirst = true
        }
      }

      const task = await createTask(folder, pm, entry.name, hasNvmrc, installFirst)
      await vscode.tasks.executeTask(task)
      // Update immediately; onDidStartTask will also fire but that's harmless
      statusBarProvider.setRunning(entry, true)
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

      const cfg2 = getConfig()
      const pickerOnly = cfg2.get('pickerOnly', false)
      const favs = getFavorites(context)
      const isFav = (entry) => favs.has(makeFavoriteKey(entry))

      const side = cfg2.get('statusBarSide', 'left')
      const alignment = side === 'right'
        ? vscode.StatusBarAlignment.Right
        : vscode.StatusBarAlignment.Left
      // Left: higher number = further left. Right: higher number = further right (use low base to stay left of the right section).
      let priority = side === 'right' ? 10 : 110

      if (pickerOnly) {
        statusBarProvider.createPickerButton(collected, priority, showScriptPicker, alignment)
      } else {
        // Favorites occupy the first slots; remaining slots filled by priority order
        const favEntries = collected.filter(isFav)
        const nonFavEntries = collected.filter(e => !isFav(e))

        let visible
        if (favEntries.length > 0) {
          const favVisible = favEntries.slice(0, maxButtons)
          const remaining = maxButtons - favVisible.length
          visible = remaining > 0
            ? [...favVisible, ...nonFavEntries.slice(0, remaining)]
            : favVisible
        } else {
          visible = collected.slice(0, maxButtons)
        }

        visible.forEach(entry => statusBarProvider.createButton(entry, priority--, alignment))

        // Sync button states for any tasks already running (e.g. after a rebuild)
        for (const execution of vscode.tasks.taskExecutions) {
          const def = execution.task.definition
          if (def?.type !== 'run-mate-script-runner') continue
          const match = visible.find(en => {
            if (en.name !== def.script) return false
            if (en.folder) return en.folder.uri.fsPath === def.folderPath
            return Array.isArray(en.variants) && en.variants.some(v => v.folder?.uri.fsPath === def.folderPath)
          })
          if (match) statusBarProvider.setRunning(match, true)
        }

        if (collected.length > visible.length) {
          statusBarProvider.createOverflowButton(collected, priority, showScriptPicker, alignment)
        }
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

    vscode.commands.registerCommand('run-mate-script-runner.showAllScripts', () => {
      showScriptPicker(lastCollected)
    })
  )

  /**
   * QuickPick with per-item star buttons. Favorites sort to the top.
   * Clicking the star button toggles the favourite state without closing the picker.
   */
  const showScriptPicker = (collected) => {
    const qp = vscode.window.createQuickPick()
    qp.placeholder = 'Select a script to run'
    qp.matchOnDescription = true

    const iconFull = new vscode.ThemeIcon('star-full')
    const iconEmpty = new vscode.ThemeIcon('star-empty')

    const buildItems = () => {
      const favs = getFavorites(context)
      return [...collected]
        .sort((a, b) => {
          const aFav = favs.has(makeFavoriteKey(a))
          const bFav = favs.has(makeFavoriteKey(b))
          if (aFav !== bFav) return aFav ? -1 : 1
          return 0
        })
        .map(entry => {
          const key = makeFavoriteKey(entry)
          const isFav = favs.has(key)
          return {
            label: isFav ? `$(star-full) ${entry.name}` : entry.name,
            description: entry.folder ? entry.folder.name : 'pick folder on run',
            entry,
            key,
            buttons: [{
              iconPath: isFav ? iconFull : iconEmpty,
              tooltip: isFav ? 'Remove from favorites' : 'Add to favorites'
            }]
          }
        })
    }

    qp.items = buildItems()

    qp.onDidTriggerItemButton(async ({ item }) => {
      await toggleFavorite(context, item.key)
      qp.items = buildItems()
    })

    qp.onDidAccept(() => {
      const [selected] = qp.selectedItems
      qp.hide()
      if (selected) runEntry(selected.entry)
    })

    qp.onDidHide(() => qp.dispose())
    qp.show()
  }

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

  const findEntryForTaskDef = (def) => {
    return lastCollected.find(en => {
      if (en.name !== def.script) return false
      if (en.folder) return en.folder.uri.fsPath === def.folderPath
      // pick-mode entry: match if any variant owns this folder path
      if (Array.isArray(en.variants)) return en.variants.some(v => v.folder?.uri.fsPath === def.folderPath)
      return false
    })
  }

  // Listeners
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("run-mate-script-runner")) applyVisibility()
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      watchPackageJson()
      applyVisibility()
    }),
    vscode.tasks.onDidStartTask(e => {
      const def = e.execution.task.definition
      if (def?.type !== 'run-mate-script-runner') return
      const entry = findEntryForTaskDef(def)
      if (entry) statusBarProvider.setRunning(entry, true)
    }),
    vscode.tasks.onDidEndTask(e => {
      const def = e.execution.task.definition
      if (def?.type !== 'run-mate-script-runner') return
      const entry = findEntryForTaskDef(def)
      if (entry) statusBarProvider.setRunning(entry, false)
    })
  )

  watchPackageJson()
  applyVisibility()

  context.subscriptions.push({ dispose: () => statusBarProvider.disposeAll() })

  return { buildButtons, disposeAll: () => statusBarProvider.disposeAll() }
}

module.exports = { registerScriptCommands }

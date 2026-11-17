const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { getConfig, updateSetting } = require('./config')
const { ensurePortFree } = require('./ports')
const { loadEnvFile } = require('./envFiles')
const { discoverProjects, mergeByName, watchedGlob } = require('./projects')
const { planRun } = require('./runPlan')
const { createTask, findExecutions, isRunMateTask, runKey } = require('./taskManager')
const { StatusBarProvider, COMMANDS, entryLabel } = require('./statusBarProvider')
const { Store } = require('./store')
const { arrange } = require('./ordering')
const { createPicker } = require('./picker')

const REBUILD_DELAY_MS = 300
const STOP_TIMEOUT_MS = 5000
/** A stop that RunMate asked for counts as such for this long. */
const STOP_GRACE_MS = 15000
/** Exit codes of Ctrl+C and of a killed process: the user stopped it, it did not fail. */
const INTERRUPTED = new Set([130, 137, 143, 3221225786, -1073741510])

/** A script of a shared group, as written in settings: "dev" or { path, script }. */
function parseRef(ref) {
  if (typeof ref === 'string') return { path: '', script: ref }
  const cleaned = String(ref?.path ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.?\/+|\/+$/g, '')
  return { path: cleaned === '.' ? '' : cleaned, script: String(ref?.script ?? '') }
}

function registerScriptCommands(context) {
  const store = new Store(context)
  const statusBar = new StatusBarProvider()

  let projects = []
  let running = new Set()
  /** Run key -> exit code of a last run that failed. Cleared when the script starts again. */
  const failed = new Map()
  /** Run key -> time RunMate asked that script to stop. */
  const stopping = new Map()

  // ---- layout -----------------------------------------------------------

  /** scripts | projects | picker */
  const resolveLayout = () => {
    const cfg = getConfig()
    if (cfg.get('pickerOnly', false)) return 'picker'
    const layout = cfg.get('statusBarLayout', 'auto')
    if (layout !== 'auto') return layout
    return projects.length > 1 ? 'projects' : 'scripts'
  }

  /** "pick" mode merges same-named scripts, except when projects have their own buttons. */
  const isMerged = () =>
    getConfig().get('workspaceMode', 'first') === 'pick' && projects.length > 1 && resolveLayout() !== 'projects'

  /** Lists shown by the picker: one project, one merged list, or every project. */
  const getGroups = (projectId) => {
    if (projectId) {
      const project = projects.find((p) => p.id === projectId)
      return project ? [{ key: project.key, label: project.name, entries: project.entries }] : []
    }
    if (isMerged()) return [{ key: '', label: 'Scripts', entries: mergeByName(projects) }]
    return projects.map((project) => ({ key: project.key, label: project.name, entries: project.entries }))
  }

  const findEntry = (entryId) => {
    for (const project of projects) {
      const entry = project.entries.find((e) => e.id === entryId)
      if (entry) return entry
    }
    return mergeByName(projects).find((e) => e.id === entryId)
  }

  // ---- groups -----------------------------------------------------------

  /** Groups from the "groups" setting, which a team shares through .vscode/settings.json. */
  const sharedGroups = () => {
    const raw = getConfig().get('groups', [])
    if (!Array.isArray(raw)) return []
    return raw
      .filter((group) => group && typeof group.name === 'string' && group.name.trim() && Array.isArray(group.scripts))
      .map((group) => ({ id: `shared:${group.name}`, name: group.name, shared: true, refs: group.scripts.map(parseRef) }))
  }

  /** Shared groups first, then the ones only this user has. */
  const allGroups = () => [...sharedGroups(), ...store.groups()]

  /** The scripts of a group that still exist. */
  const groupEntries = (group) => {
    const entries = projects.flatMap((project) => project.entries)
    if (group.shared) {
      return group.refs
        .map((ref) => entries.find((entry) => entry.project.relPath === ref.path && entry.script === ref.script))
        .filter(Boolean)
    }
    const byKey = new Map(entries.map((entry) => [entry.key, entry]))
    return group.keys.map((key) => byKey.get(key)).filter(Boolean)
  }

  const toShared = (name, entries) => ({
    name,
    scripts: entries.map((entry) =>
      entry.project.relPath ? { path: entry.project.relPath, script: entry.script } : entry.script
    ),
  })

  const rawSharedGroups = () => {
    const raw = getConfig().get('groups', [])
    return Array.isArray(raw) ? raw : []
  }

  /** Creates or changes a group. A shared group is written back to settings. */
  const saveGroup = async (existing, name, entries) => {
    if (existing?.shared) {
      await updateSetting(
        'groups',
        rawSharedGroups().map((group) => (group?.name === existing.name ? toShared(name, entries) : group))
      )
      return
    }
    await store.saveGroup({
      id: existing ? existing.id : `g${Date.now()}`,
      name,
      keys: entries.map((entry) => entry.key),
    })
  }

  const deleteGroup = async (group) => {
    if (group.shared) {
      await updateSetting(
        'groups',
        rawSharedGroups().filter((other) => other?.name !== group.name)
      )
    } else {
      await store.deleteGroup(group.id)
    }
  }

  /** Moves a personal group into the workspace settings, where the whole team gets it. */
  const shareGroup = async (group) => {
    const entries = groupEntries(group)
    if (!entries.length) return
    const others = rawSharedGroups().filter((other) => other?.name !== group.name)
    await getConfig().update('groups', [...others, toShared(group.name, entries)], vscode.ConfigurationTarget.Workspace)
    await store.deleteGroup(group.id)
  }

  // ---- env files --------------------------------------------------------

  /** The env file an entry runs with: its own choice, else the "envFile" setting if that file exists. */
  const envFileOf = (entry) => {
    if (!entry.project) return ''
    const own = store.envFile(entry.key)
    if (own !== undefined) return own
    const fallback = String(getConfig().get('envFile', '') || '').trim()
    return fallback && fs.existsSync(path.resolve(entry.project.dir, fallback)) ? fallback : ''
  }

  // ---- running state ----------------------------------------------------

  const isRunning = (entry) =>
    entry.variants ? entry.variants.some(isRunning) : running.has(runKey(entry.project.dir, entry.script))

  /** Exit code of the last run when it failed, otherwise undefined. */
  const failure = (entry) => {
    if (entry.variants) return entry.variants.map(failure).find((code) => code !== undefined)
    return failed.get(runKey(entry.project.dir, entry.script))
  }

  const info = { isRunning, failure, envFile: envFileOf }

  const syncRunning = (endedExecution) => {
    running = new Set(
      vscode.tasks.taskExecutions
        .filter((execution) => execution !== endedExecution && isRunMateTask(execution.task))
        .map((execution) => runKey(execution.task.definition.folderPath, execution.task.definition.script))
    )
    statusBar.refresh()
  }

  const stopEntry = async (entry) => {
    const targets = entry.variants || [entry]
    for (const target of targets) {
      for (const execution of findExecutions(target.project.dir, target.script)) {
        stopping.set(runKey(target.project.dir, target.script), Date.now())
        try {
          execution.terminate()
        } catch {}
      }
    }
  }

  const waitUntilStopped = async (entry) => {
    const deadline = Date.now() + STOP_TIMEOUT_MS
    while (findExecutions(entry.project.dir, entry.script).length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  // ---- run --------------------------------------------------------------

  const runEntry = async (entry, options = {}) => {
    try {
      let target = entry
      if (entry.variants) {
        const pick = await vscode.window.showQuickPick(
          entry.variants.map((variant) => ({
            label: variant.project.name,
            description: variant.project.relPath || variant.project.dir,
            variant,
          })),
          { placeHolder: `Select the project to run '${entry.name}' in` }
        )
        if (!pick) return
        target = pick.variant
      }

      const cfg = getConfig()
      const project = target.project

      let restarted = false
      if (isRunning(target)) {
        if (options.skipIfRunning) return
        restarted = true
        if (cfg.get('askBeforeKill', true)) {
          const pick = await vscode.window.showWarningMessage(
            `'${target.name}' is already running in ${project.name}`,
            { modal: true },
            'Restart',
            'Stop'
          )
          if (!pick) return
          if (pick === 'Stop') {
            await stopEntry(target)
            return
          }
        }
        await stopEntry(target)
        await waitUntilStopped(target)
      }

      const envFile = options.envFile !== undefined ? options.envFile : envFileOf(target)
      let env = null
      if (envFile) {
        env = await loadEnvFile(project, envFile)
        if (!env) {
          vscode.window.showErrorMessage(
            `RunMate: '${target.name}' is set to run with the env file "${envFile}", but that file is not in ${project.name}. ` +
              'Choose another one with the "Run with options" button in the script list.'
          )
          return
        }
      }

      const portFree = await ensurePortFree({
        entry: target,
        project,
        args: options.args,
        env,
        envFile,
        cfg,
        // A script that was just stopped needs a moment to let go of its port.
        waitMs: restarted ? 3000 : 0,
      })
      if (!portFree) return

      const plan = await planRun(project, target, cfg, options)
      if (!plan) return
      if (env) plan.env = env

      const label = envFile ? `${entryLabel(target)} [${envFile}]` : entryLabel(target)
      const task = createTask(project, target.script, label, plan, cfg.get('reuseTerminalForScripts', true))
      await vscode.tasks.executeTask(task)
      await store.setLastRun({ id: target.id, shell: options.shell, args: options.args })
    } catch (error) {
      vscode.window.showErrorMessage(`RunMate: failed to run ${entry.name}. ${error.message}`)
    }
  }

  /** Starts every script of a group. Scripts that already run are left alone. */
  const runGroup = async (group) => {
    const entries = groupEntries(group)
    if (!entries.length) {
      vscode.window.showWarningMessage(`RunMate: the scripts of group "${group.name}" no longer exist.`)
      return
    }
    for (const entry of entries) await runEntry(entry, { skipIfRunning: true })
  }

  const stopGroup = async (group) => {
    for (const entry of groupEntries(group)) await stopEntry(entry)
  }

  const runLast = async () => {
    const last = store.lastRun()
    const entry = last && findEntry(last.id)
    if (!entry) {
      vscode.window.showInformationMessage('RunMate: no script has been run in this workspace yet.')
      return
    }
    await runEntry(entry, { shell: last.shell, args: last.args })
  }

  // ---- status bar -------------------------------------------------------

  const render = () => {
    statusBar.disposeAll()

    const cfg = getConfig()
    if (!cfg.get('useDynamicScriptParsing', true) || !projects.length) return

    const alignment =
      cfg.get('statusBarSide', 'left') === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left
    // Each new item gets a lower priority, so items appear left to right in
    // the order they are created on either side.
    let priority = alignment === vscode.StatusBarAlignment.Right ? 10 : 110

    const layout = resolveLayout()

    if (layout === 'picker') {
      const count = projects.reduce((sum, project) => sum + project.entries.length, 0)
      statusBar.addMoreButton(
        '$(list-unordered) Scripts',
        `RunMate: ${count} scripts - open the script list`,
        alignment,
        priority
      )
      return
    }

    for (const group of allGroups()) {
      const entries = groupEntries(group)
      if (entries.length) statusBar.addGroupButton(group, entries, alignment, priority--, info)
    }

    if (layout === 'projects') {
      const max = Math.max(1, Number(cfg.get('maxProjectButtons', 4)) || 4)
      const shown = projects.slice(0, max)
      for (const project of shown) statusBar.addProjectButton(project, alignment, priority--, info)
      if (projects.length > shown.length) {
        statusBar.addMoreButton(
          `$(ellipsis) +${projects.length - shown.length}`,
          'RunMate: more projects - open the full script list',
          alignment,
          priority
        )
      }
      return
    }

    // layout === 'scripts'
    const configuredMax = Number(cfg.get('maxDynamicScriptButtons', 8))
    const max = Number.isFinite(configuredMax) ? Math.max(0, Math.floor(configuredMax)) : 8
    const favorites = store.favorites()
    const hidden = store.hidden()
    const scriptOrder = cfg.get('scriptOrder', [])
    const merged = isMerged()

    const starred = []
    const others = []
    for (const group of getGroups()) {
      const arranged = arrange(group.entries, { favorites, hidden, customOrder: store.order(group.key), scriptOrder })
      starred.push(...arranged.favorites)
      others.push(...arranged.others)
    }

    // Favorites take the first slots, the rest follows in list order.
    const candidates = [...starred, ...others]
    const shown = candidates.slice(0, max)
    for (const entry of shown) {
      const label =
        projects.length > 1 && !merged && entry.project
          ? `${entryLabel(entry)} (${entry.project.name})`
          : entryLabel(entry)
      statusBar.addScriptButton(entry, label, alignment, priority--, info)
    }

    const rest = candidates.length - shown.length
    statusBar.addMoreButton(
      rest > 0 ? `$(ellipsis) +${rest}` : '$(ellipsis)',
      rest > 0 ? `RunMate: ${rest} more scripts, list settings` : 'RunMate: all scripts, list settings',
      alignment,
      priority
    )
  }

  // ---- discovery --------------------------------------------------------

  let building = null
  let queued = false

  /** Rescans projects and redraws. Calls made while a scan runs are folded into one more scan. */
  const rediscover = () => {
    if (building) {
      queued = true
      return building
    }
    building = (async () => {
      try {
        do {
          queued = false
          projects = await discoverProjects(getConfig())
          render()
        } while (queued)
      } catch (error) {
        console.error('RunMate: failed to read projects:', error)
      } finally {
        building = null
      }
    })()
    return building
  }

  let timer = null
  const scheduleRediscover = () => {
    clearTimeout(timer)
    timer = setTimeout(rediscover, REBUILD_DELAY_MS)
  }

  let watchers = []
  const watchPackageFiles = () => {
    watchers.forEach((watcher) => watcher.dispose())
    watchers = (vscode.workspace.workspaceFolders ?? []).map((folder) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, watchedGlob()))
      const onEvent = (uri) => {
        // Installs rewrite thousands of files in node_modules.
        if (!/[\\/]node_modules[\\/]/.test(uri.fsPath)) scheduleRediscover()
      }
      watcher.onDidChange(onEvent)
      watcher.onDidCreate(onEvent)
      watcher.onDidDelete(onEvent)
      return watcher
    })
  }

  const picker = createPicker({
    store,
    getProjects: () => projects,
    getGroups,
    isRunning,
    runEntry,
    stopEntry,
    render,
    rediscover,
    groupEntries,
    runGroup,
    stopGroup,
    allGroups,
    saveGroup,
    deleteGroup,
    shareGroup,
    failure,
    envFileOf,
  })

  /** A script ended on its own with an error: mark its button and say so. */
  const onProcessEnd = (event) => {
    const task = event.execution.task
    if (!isRunMateTask(task)) return
    const { folderPath, script } = task.definition
    const key = runKey(folderPath, script)
    const stoppedAt = stopping.get(key)
    stopping.delete(key)

    const code = event.exitCode
    if (!code || INTERRUPTED.has(code) || (stoppedAt && Date.now() - stoppedAt < STOP_GRACE_MS)) return

    failed.set(key, code)
    statusBar.refresh()
    if (!getConfig().get('notifyOnFailure', true)) return

    const entry = projects
      .flatMap((project) => project.entries)
      .find((other) => other.project.dir === folderPath && other.script === script)
    const again = 'Run again'
    const show = 'Show terminal'
    vscode.window
      .showErrorMessage(`RunMate: '${task.name}' failed (exit code ${code}).`, ...(entry ? [again, show] : [show]))
      .then((pick) => {
        if (pick === again) return runEntry(entry)
        if (pick === show) {
          const terminal = (vscode.window.terminals || []).find((other) => other.name.includes(task.name))
          if (terminal) terminal.show()
          else vscode.commands.executeCommand('workbench.action.terminal.focus')
        }
      })
  }

  // ---- wiring -----------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.all, async () => {
      if (!projects.length) await rediscover()
      picker.show()
    }),
    vscode.commands.registerCommand(COMMANDS.project, (projectId) => picker.show(projectId)),
    vscode.commands.registerCommand(COMMANDS.run, (entryId) => {
      const entry = findEntry(entryId)
      if (entry) return runEntry(entry)
    }),
    vscode.commands.registerCommand(COMMANDS.stop, (entryId) => {
      const entry = findEntry(entryId)
      if (entry) return stopEntry(entry)
    }),
    vscode.commands.registerCommand(COMMANDS.runGroup, (groupId) => {
      const group = allGroups().find((g) => g.id === groupId)
      if (group) return runGroup(group)
    }),
    vscode.commands.registerCommand(COMMANDS.stopGroup, (groupId) => {
      const group = allGroups().find((g) => g.id === groupId)
      if (group) return stopGroup(group)
    }),
    vscode.commands.registerCommand(COMMANDS.rerun, runLast),
    vscode.commands.registerCommand(COMMANDS.newGroup, async () => {
      if (!projects.length) await rediscover()
      await picker.editGroup()
    }),
    vscode.commands.registerCommand(COMMANDS.guide, () =>
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        `${context.extension.id}#runmate.gettingStarted`,
        false
      )
    ),
    vscode.commands.registerCommand(COMMANDS.stopAll, async () => {
      const executions = vscode.tasks.taskExecutions.filter((execution) => isRunMateTask(execution.task))
      if (!executions.length) {
        vscode.window.showInformationMessage('RunMate: no running scripts')
        return
      }
      const pick = await vscode.window.showWarningMessage(
        `Stop ${executions.length} running script(s)?`,
        { modal: true },
        'Stop All'
      )
      if (pick !== 'Stop All') return
      for (const execution of executions) {
        const { folderPath, script } = execution.task.definition
        stopping.set(runKey(folderPath, script), Date.now())
        execution.terminate()
      }
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('run-mate-script-runner')) scheduleRediscover()
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      watchPackageFiles()
      scheduleRediscover()
    }),
    vscode.tasks.onDidStartTask((event) => {
      const task = event.execution.task
      if (!isRunMateTask(task)) return
      const key = runKey(task.definition.folderPath, task.definition.script)
      failed.delete(key)
      stopping.delete(key)
      syncRunning()
    }),
    vscode.tasks.onDidEndTaskProcess(onProcessEnd),
    vscode.tasks.onDidEndTask((event) => {
      if (isRunMateTask(event.execution.task)) syncRunning(event.execution)
    }),
    {
      dispose: () => {
        clearTimeout(timer)
        watchers.forEach((watcher) => watcher.dispose())
        statusBar.disposeAll()
      },
    }
  )

  watchPackageFiles()
  syncRunning()
  rediscover()
}

module.exports = { registerScriptCommands }

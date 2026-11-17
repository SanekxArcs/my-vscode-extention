const vscode = require('vscode')

const COMMANDS = {
  run: 'run-mate-script-runner.runScript',
  stop: 'run-mate-script-runner.stopScript',
  project: 'run-mate-script-runner.showProjectScripts',
  all: 'run-mate-script-runner.showAllScripts',
  runGroup: 'run-mate-script-runner.runGroup',
  stopGroup: 'run-mate-script-runner.stopGroup',
  rerun: 'run-mate-script-runner.runLastScript',
  stopAll: 'run-mate-script-runner.stopRunningScripts',
  newGroup: 'run-mate-script-runner.newGroup',
  guide: 'run-mate-script-runner.openGuide',
}

/** Text shown for an entry: "build" for package.json, "make build" for other sources. */
function entryLabel(entry) {
  return entry.kind && entry.kind !== 'npm' ? `${entry.kind} ${entry.name}` : entry.name
}

function scriptIcon(name) {
  if (name.includes('dev')) return '$(play)'
  if (name.includes('build')) return '$(gear)'
  if (name.includes('start')) return '$(rocket)'
  return '$(terminal)'
}

const WARNING = () => new vscode.ThemeColor('statusBarItem.warningForeground')

function paint(item, look) {
  item.color = look === 'running' ? WARNING() : look === 'failed' ? new vscode.ThemeColor('statusBarItem.errorForeground') : undefined
  item.backgroundColor = look === 'failed' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined
}

/**
 * Owns the status bar items. Buttons call fixed commands with arguments, so
 * nothing is registered per script and two scripts can never collide.
 *
 * `info` answers questions about an entry: `isRunning(entry)`,
 * `failure(entry)` (exit code of a failed last run, or undefined) and
 * `envFile(entry)` (the env file it runs with, or '').
 */
class StatusBarProvider {
  constructor() {
    this.items = []
    this.refreshers = []
  }

  disposeAll() {
    for (const item of this.items) {
      try {
        item.dispose()
      } catch {}
    }
    this.items = []
    this.refreshers = []
  }

  _add(alignment, priority, refresh) {
    const item = vscode.window.createStatusBarItem(alignment, priority)
    this.items.push(item)
    this.refreshers.push(() => refresh(item))
    refresh(item)
    item.show()
  }

  /** Re-applies text, colour and command after a script started, stopped or failed. */
  refresh() {
    for (const refresh of this.refreshers) refresh()
  }

  /** One button that runs a script, and turns into a stop button while it runs. */
  addScriptButton(entry, label, alignment, priority, info) {
    const where = entry.project ? ` [${entry.project.name}]` : ''
    this._add(alignment, priority, (item) => {
      const envFile = info.envFile(entry)
      const withEnv = envFile ? ` (env file: ${envFile})` : ''
      const code = info.failure(entry)
      if (info.isRunning(entry)) {
        item.text = `$(stop-circle) ${label}`
        item.tooltip = `Stop${where}: ${entryLabel(entry)}`
        item.command = { command: COMMANDS.stop, title: 'Stop', arguments: [entry.id] }
        paint(item, 'running')
      } else if (code !== undefined) {
        item.text = `$(error) ${label}`
        item.tooltip = `Failed with exit code ${code}${where}: ${entryLabel(entry)}${withEnv}. Click to run it again`
        item.command = { command: COMMANDS.run, title: 'Run again', arguments: [entry.id] }
        paint(item, 'failed')
      } else {
        item.text = `${scriptIcon(entry.name)} ${label}`
        item.tooltip = `Run${where}: ${entryLabel(entry)} -> ${entry.command}${withEnv}`
        item.command = { command: COMMANDS.run, title: 'Run', arguments: [entry.id] }
        paint(item, 'idle')
      }
    })
  }

  /** One button that starts every script of a group, or stops them while any is running. */
  addGroupButton(group, entries, alignment, priority, info) {
    const list = entries.map((entry) => (entry.project ? `${entry.project.name}: ${entry.name}` : entry.name)).join(', ')
    this._add(alignment, priority, (item) => {
      const failed = entries.filter((entry) => info.failure(entry) !== undefined).map(entryLabel)
      if (entries.some(info.isRunning)) {
        item.text = `$(stop-circle) ${group.name}`
        item.tooltip = `Stop group "${group.name}" (${list})`
        item.command = { command: COMMANDS.stopGroup, title: 'Stop group', arguments: [group.id] }
        paint(item, 'running')
      } else {
        item.text = `${failed.length ? '$(error)' : '$(run-all)'} ${group.name}`
        item.tooltip = failed.length
          ? `Group "${group.name}": ${failed.join(', ')} failed. Click to run the group again (${list})`
          : `Run group "${group.name}" (${list})`
        item.command = { command: COMMANDS.runGroup, title: 'Run group', arguments: [group.id] }
        paint(item, failed.length ? 'failed' : 'idle')
      }
    })
  }

  /** One button per project; it opens that project's scripts. */
  addProjectButton(project, alignment, priority, info) {
    this._add(alignment, priority, (item) => {
      const running = project.entries.filter(info.isRunning).map(entryLabel)
      const failed = project.entries.filter((entry) => info.failure(entry) !== undefined).map(entryLabel)
      const where = project.relPath || 'workspace root'
      if (running.length) {
        item.text = `$(sync~spin) ${project.name}`
        item.tooltip = `RunMate: ${project.name} (${where}) - running: ${running.join(', ')}`
        paint(item, 'running')
      } else if (failed.length) {
        item.text = `$(error) ${project.name}`
        item.tooltip = `RunMate: ${project.name} (${where}) - failed: ${failed.join(', ')}. Click to see its scripts`
        paint(item, 'failed')
      } else {
        item.text = `$(package) ${project.name}`
        item.tooltip = `RunMate: scripts of ${project.name} (${where})`
        paint(item, 'idle')
      }
      item.command = { command: COMMANDS.project, title: 'Scripts', arguments: [project.id] }
    })
  }

  /** The "more" button: opens the full picker, where the settings live too. */
  addMoreButton(text, tooltip, alignment, priority) {
    this._add(alignment, priority, (item) => {
      item.text = text
      item.tooltip = tooltip
      item.command = COMMANDS.all
    })
  }
}

module.exports = { StatusBarProvider, COMMANDS, entryLabel }

const vscode = require('vscode')
const { slugify } = require('./packageUtils')

class StatusBarProvider {
  constructor(context, onRunEntry, onStopEntry) {
    this.context = context
    this.onRunEntry = onRunEntry
    this.onStopEntry = onStopEntry
    this.statusItems = []
    this.registeredCommands = []
    this.buttonMap = new Map()
  }

  disposeAll() {
    this.statusItems.forEach(item => {
      try { item.dispose() } catch {}
    })
    this.registeredCommands.forEach(cmd => {
      try { cmd.dispose() } catch {}
    })
    this.statusItems = []
    this.registeredCommands = []
    this.buttonMap = new Map()
  }

  _entryKey(entry) {
    const folderKey = entry.folder ? entry.folder.name : 'pick'
    return `${slugify(folderKey)}_${slugify(entry.name)}`
  }

  _getIcon(name) {
    return name.includes('dev')
      ? '$(play)'
      : name.includes('build')
        ? '$(gear)'
        : name.includes('start')
          ? '$(rocket)'
          : '$(terminal)'
  }

  makeCommandId(entry) {
    const folderKey = entry.folder ? entry.folder.name : "pick";
    const nameKey = entry.name;
    return `run-mate-script-runner.runScript.${slugify(folderKey)}_${slugify(nameKey)}`;
  }

  _makeStopCommandId(entry) {
    const folderKey = entry.folder ? entry.folder.name : 'pick'
    return `run-mate-script-runner.stopScript.${slugify(folderKey)}_${slugify(entry.name)}`
  }

  createButton(entry, priority, alignment = vscode.StatusBarAlignment.Left) {
    const item = vscode.window.createStatusBarItem(alignment, priority)
    const icon = this._getIcon(entry.name)

    item.text = `${icon} ${entry.name}`
    const tooltipFolder = entry.folder ? ` [${entry.folder.name}]` : ''
    item.tooltip = `Run script${tooltipFolder}: ${entry.name} -> ${entry.command}`

    const runCommandId = this.makeCommandId(entry)
    const stopCommandId = this._makeStopCommandId(entry)

    const runDisposable = vscode.commands.registerCommand(runCommandId, () => this.onRunEntry(entry))
    const stopDisposable = vscode.commands.registerCommand(stopCommandId, () => this.onStopEntry(entry))

    this.registeredCommands.push(runDisposable, stopDisposable)

    item.command = runCommandId
    item.show()
    this.statusItems.push(item)

    const key = this._entryKey(entry)
    this.buttonMap.set(key, { item, runCommandId, stopCommandId, entry })
  }

  setRunning(entry, isRunning) {
    const key = this._entryKey(entry)
    const btn = this.buttonMap.get(key)
    if (!btn) return

    const { item, runCommandId, stopCommandId, entry: e } = btn
    if (isRunning) {
      item.text = `$(stop-circle) ${e.name}`
      const tooltipFolder = e.folder ? ` [${e.folder.name}]` : ''
      item.tooltip = `Stop script${tooltipFolder}: ${e.name}`
      item.command = stopCommandId
      item.color = new vscode.ThemeColor('statusBarItem.warningForeground')
    } else {
      const icon = this._getIcon(e.name)
      const tooltipFolder = e.folder ? ` [${e.folder.name}]` : ''
      item.text = `${icon} ${e.name}`
      item.tooltip = `Run script${tooltipFolder}: ${e.name} -> ${e.command}`
      item.command = runCommandId
      item.color = undefined
    }
  }

  createPickerButton(collected, priority, onShowPicker, alignment = vscode.StatusBarAlignment.Left) {
    const item = vscode.window.createStatusBarItem(alignment, priority)
    item.text = '$(list-unordered) Scripts'
    item.tooltip = `RunMate: open script picker (${collected.length} scripts, favorites first)`

    const commandId = `run-mate-script-runner.runScript._picker_${Date.now()}`
    const cmd = vscode.commands.registerCommand(commandId, () => onShowPicker(collected))
    this.registeredCommands.push(cmd)

    item.command = commandId
    item.show()
    this.statusItems.push(item)
  }

  createOverflowButton(collected, priority, onShowPicker, alignment = vscode.StatusBarAlignment.Left) {
    const overflowItem = vscode.window.createStatusBarItem(alignment, priority)
    overflowItem.text = `$(ellipsis) +${collected.length}`
    overflowItem.tooltip = 'More scripts'

    const overflowCommandId = `run-mate-script-runner.runScript._overflow_${Date.now()}`
    const overflowCmd = vscode.commands.registerCommand(overflowCommandId, () => {
      onShowPicker(collected)
    })

    this.registeredCommands.push(overflowCmd)

    overflowItem.command = overflowCommandId
    overflowItem.show()
    this.statusItems.push(overflowItem)
  }
}

module.exports = { StatusBarProvider }

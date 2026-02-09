const vscode = require('vscode')
const { slugify } = require('./packageUtils')

class StatusBarProvider {
  constructor(context, onRunEntry) {
    this.context = context
    this.onRunEntry = onRunEntry
    this.statusItems = []
    this.registeredCommands = []
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
  }

  makeCommandId(entry) {
    const folderKey = entry.folder ? entry.folder.name : "pick";
    const nameKey = entry.name;
    return `run-mate-script-runner.runScript.${slugify(folderKey)}_${slugify(nameKey)}`;
  }

  createButton(entry, priority) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority)
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

    const commandId = this.makeCommandId(entry)
    const disposable = vscode.commands.registerCommand(commandId, () => this.onRunEntry(entry))
    
    this.registeredCommands.push(disposable)

    item.command = commandId
    item.show()
    this.statusItems.push(item)
  }

  createOverflowButton(collected, priority) {
    const overflowItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority)
    overflowItem.text = `$(ellipsis) +${collected.length}`
    overflowItem.tooltip = 'More scripts'

    const overflowCommandId = `run-mate-script-runner.runScript._overflow_${Date.now()}`
    const overflowCmd = vscode.commands.registerCommand(overflowCommandId, async () => {
      const pick = await vscode.window.showQuickPick(
        collected.map((entry) => ({
          label: entry.name,
          description: entry.folder ? entry.folder.name : 'pick folder on run',
          entry,
        })),
        { placeHolder: 'Select a script to run' }
      )
      if (pick) this.onRunEntry(pick.entry)
    })

    this.registeredCommands.push(overflowCmd)

    overflowItem.command = overflowCommandId
    overflowItem.show()
    this.statusItems.push(overflowItem)
  }
}

module.exports = { StatusBarProvider }

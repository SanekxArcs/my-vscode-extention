const vscode = require('vscode')
const { getConfig } = require('./config')

function registerGitShortcuts(context) {
  let customButtons = []
  let customCommands = []

  const clearCustomButtons = () => {
    for (const item of customButtons) { try { item.dispose() } catch {} }
    for (const cmd of customCommands) { try { cmd.dispose() } catch {} }
    customButtons = []
    customCommands = []
  }

  const buildCustomTerminalButtons = () => {
    clearCustomButtons()

    const cfg = getConfig()
    const custom = cfg.get('customTerminals', []) || []
    if (!Array.isArray(custom) || custom.length === 0) return

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]

    const buttonLabel = (cfg.get('customTerminalsButtonLabel', 'git-c') || 'git-c').toString()
    const basePriority = 96
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, basePriority)
    item.text = '$(terminal) ' + buttonLabel
    item.tooltip = 'Open saved commands'

    const cmdId = 'extension.customTerminal._quickPick'
    let lastPicked = context.globalState.get('runScript.lastCustomTerminal') || null

    const runCustomEntry = async (entry) => {
      const title = entry.title.trim()
      const commandToRun = entry.command.trim()
      const term = vscode.window.createTerminal(title)
      term.show()
      if (workspaceFolder) { term.sendText(`cd "${workspaceFolder.uri.fsPath}"`) }
      term.sendText(commandToRun)
      lastPicked = { title, command: commandToRun }
      await context.globalState.update('runScript.lastCustomTerminal', lastPicked)
    }

    const disp = vscode.commands.registerCommand(cmdId, async () => {
      try {
        const picks = custom
          .filter((e) => e && typeof e.title === 'string' && typeof e.command === 'string')
          .map((e, idx) => ({ label: e.title.trim(), description: e.command.trim(), idx }))
          .filter((p) => p.label && p.description)

        if (picks.length === 0) {
          vscode.window.showInformationMessage('No valid custom commands configured')
          return
        }

        const picked = await vscode.window.showQuickPick(picks, { placeHolder: 'Select a command to run' })
        if (!picked) return
        const entry = custom[picked.idx]
        await runCustomEntry(entry)
        updatePinned()
      } catch (error) {
        vscode.window.showErrorMessage(`Error running custom command: ${error.message}`)
      }
    })

    customCommands.push(disp)
    context.subscriptions.push(disp)

    const openCmd = vscode.commands.registerCommand('extension.openCustomTerminals', async () => vscode.commands.executeCommand(cmdId))
    const runLastCmd = vscode.commands.registerCommand('extension.runLastCustomTerminal', async () => {
      if (!lastPicked) { vscode.window.showInformationMessage('No last custom command yet. Pick one first.'); return }
      await runCustomEntry(lastPicked)
    })
    customCommands.push(openCmd, runLastCmd)
    context.subscriptions.push(openCmd, runLastCmd)

    item.command = cmdId
    item.show()
    customButtons.push(item)
    context.subscriptions.push(item)

    let pinnedItem = null
    const updatePinned = () => {
      if (pinnedItem) { try { pinnedItem.dispose() } catch {} ; pinnedItem = null }
      const pinEnabled = cfg.get('pinLastCustomTerminal', false)
      if (!pinEnabled || !lastPicked) return
      const prefix = (cfg.get('pinLastCustomTerminalLabelPrefix', '★') || '★').toString()
      pinnedItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, basePriority - 1)
      pinnedItem.text = `${prefix} ${lastPicked.title}`
      pinnedItem.tooltip = `Run last custom: ${lastPicked.command}`
      const pinCmdId = 'extension.customTerminal._runPinned'
      const pinDisp = vscode.commands.registerCommand(pinCmdId, async () => {
        try { await runCustomEntry(lastPicked) } catch (error) { vscode.window.showErrorMessage(`Error running pinned command: ${error.message}`) }
      })
      customCommands.push(pinDisp)
      context.subscriptions.push(pinDisp)
      pinnedItem.command = pinCmdId
      pinnedItem.show()
      customButtons.push(pinnedItem)
      context.subscriptions.push(pinnedItem)
    }

    updatePinned()
  }

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration('runScript.customTerminals') ||
      e.affectsConfiguration('runScript.customTerminalsButtonLabel') ||
      e.affectsConfiguration('runScript.pinLastCustomTerminal') ||
      e.affectsConfiguration('runScript.pinLastCustomTerminalLabelPrefix')
    ) {
      buildCustomTerminalButtons()
    }
  })
  context.subscriptions.push(onConfigChange)

  buildCustomTerminalButtons()

  return { buildCustomTerminalButtons, clearCustomButtons }
}

module.exports = { registerGitShortcuts }

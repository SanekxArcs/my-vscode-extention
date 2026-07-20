const vscode = require('vscode')
const { getConfig } = require('./config')

const GLOBAL_LAST_COMMAND_KEY = 'terminal-mate.lastCommand'
const GLOBAL_HISTORY_KEY = 'terminal-mate.history'

function shellEscapePosix(input) {
  if (input == null) return ''
  const value = String(input)
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function normalizeOs(os) {
  const map = {
    win32: 'win32',
    windows: 'win32',
    darwin: 'darwin',
    mac: 'darwin',
    macos: 'darwin',
    linux: 'linux',
  }
  const normalized = String(os || '').toLowerCase()
  return map[normalized] || normalized
}

function registerTerminalMate(context) {
  let statusItems = []
  let disposables = []
  let finishStatusItem = null
  let pendingSnippet = null // { terminal, suffix }
  let cachedLastCommand = context.globalState.get(GLOBAL_LAST_COMMAND_KEY) || null

  const needsConfirmation = (command) => {
    if (!command) return false
    const lower = command.toLowerCase()
    if (/git\s+reset\s+--hard/.test(lower)) return true
    if (/git\s+clean[\s\S]*(-fd|--force)/.test(lower)) return true
    if (/git\s+push[\s\S]*\s(-f|--force)(\s|$)/.test(lower)) return true
    return false
  }

  const confirmDangerousIfNeeded = async (command) => {
    const cfg = getConfig()
    if (!cfg.get('confirmDangerousCommands', true)) return true
    if (!needsConfirmation(command)) return true
    const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
      placeHolder: 'This command looks dangerous. Continue?',
    })
    return answer === 'Yes'
  }

  const clearStatusItems = () => {
    for (const item of statusItems) {
      try { item.dispose() } catch {}
    }
    statusItems = []
  }

  const clearDisposables = () => {
    for (const disp of disposables) {
      try { disp.dispose() } catch {}
    }
    disposables = []
  }

  const pushHistory = async (title, command) => {
    const cfg = getConfig()
    const size = Math.max(0, Number(cfg.get('customHistorySize', 10)) || 10)
    const history = context.globalState.get(GLOBAL_HISTORY_KEY, [])
    history.unshift({ title, command, at: Date.now() })
    while (history.length > size) history.pop()
    await context.globalState.update(GLOBAL_HISTORY_KEY, history)
  }

  const resolvePlaceholders = async (template, folder) => {
    const cfg = getConfig()
    const cursorSymbol = cfg.get('cursorSymbol', '<|>') || '<|>'
    const cache = new Map()
    let text = template

    const clipboardText = await vscode.env.clipboard.readText()

    const replaceToken = async (match, body) => {
      if (body.startsWith('input:')) {
        if (cache.has(match)) return cache.get(match)
        const label = body.slice('input:'.length)
        const value = await vscode.window.showInputBox({ prompt: label })
        const escaped = shellEscapePosix(value ?? '')
        cache.set(match, escaped)
        return escaped
      }
      if (body.startsWith('pick:')) {
        const rest = body.slice('pick:'.length)
        const [label, ...options] = rest.split('|')
        const picked = await vscode.window.showQuickPick(options, { placeHolder: label })
        return shellEscapePosix(picked ?? '')
      }
      if (body.startsWith('env:')) {
        const key = body.slice('env:'.length)
        return shellEscapePosix(process.env[key] || '')
      }
      if (body === 'workspaceFolder') {
        return shellEscapePosix(folder?.uri.fsPath || '')
      }
      if (body === 'clipboard') {
        return shellEscapePosix(clipboardText || '')
      }
      return match
    }

    const regex = /(\\)?\$\{([^}]+)\}/g
    let match
    let output = ''
    let idx = 0
    while ((match = regex.exec(text)) !== null) {
      output += text.slice(idx, match.index)
      if (match[1] === '\\') {
        output += match[0].slice(1)
      } else {
        output += await replaceToken(match[0], match[2])
      }
      idx = match.index + match[0].length
    }
    output += text.slice(idx)

    return { result: output, cursorSymbol }
  }

  const showPreviewIfNeeded = async (command) => {
    const cfg = getConfig()
    if (!cfg.get('showPreviewForCustomTerminals', false)) return true
    const choice = await vscode.window.showInformationMessage(`Run: ${command}`, { modal: true }, 'Run')
    return choice === 'Run'
  }

  const runCustomEntry = async (entry) => {
    const title = (entry.title || '').trim()
    let template = (entry.command || '').trim()
    if (!title || !template) return

    if (entry.os) {
      const osList = Array.isArray(entry.os) ? entry.os : [entry.os]
      const normalized = osList.map(normalizeOs)
      if (!normalized.includes(process.platform)) return
    }

    let folder = null
    try {
      const activeDoc = vscode.window.activeTextEditor?.document
      if (activeDoc && activeDoc.uri) {
        folder = vscode.workspace.getWorkspaceFolder(activeDoc.uri)
      }
    } catch {}
    if (!folder) folder = vscode.workspace.workspaceFolders?.[0] || null

    const { result, cursorSymbol } = await resolvePlaceholders(template, folder)

    const cfg = getConfig()
    const reuseSetting = cfg.get('reuseTerminalByTitle', true)
    const reuse = typeof entry.reuse === 'boolean' ? entry.reuse : reuseSetting
    const cwd = entry.cwd || folder?.uri?.fsPath || process.cwd()

    let terminal = reuse ? vscode.window.terminals.find((term) => term.name === title) : null
    if (!terminal) terminal = vscode.window.createTerminal({ name: title, cwd })
    terminal.show()

    if (result.includes(cursorSymbol)) {
      const [head, tail] = result.split(cursorSymbol)
      terminal.sendText(head, false)
      pendingSnippet = { terminal, suffix: tail }
      if (!finishStatusItem) {
        finishStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95)
        finishStatusItem.text = '$(arrow-right) Finish snippet'
        finishStatusItem.tooltip = 'Finish current custom snippet'
        finishStatusItem.command = 'terminal-mate.finishSnippet'
        context.subscriptions.push(finishStatusItem)
      }
      finishStatusItem.show()
    } else {
      if (!(await confirmDangerousIfNeeded(result))) return
      if (!(await showPreviewIfNeeded(result))) return
      terminal.sendText(result)
      await pushHistory(title, result)
    }

    cachedLastCommand = { title, command: template }
    await context.globalState.update(GLOBAL_LAST_COMMAND_KEY, cachedLastCommand)
  }

  const buildCustomTerminalButtons = async () => {
    clearStatusItems()
    clearDisposables()

    const cfg = getConfig()
    if (!cfg.get('showStatusBar', true)) return

    const customEntries = cfg.get('customTerminals', []) || []
    if (!Array.isArray(customEntries) || customEntries.length === 0) return

    const buttonLabel = (cfg.get('customTerminalsButtonLabel', 'TM') || 'TM').toString()
    const basePriority = 96
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, basePriority)
    statusItem.text = '$(terminal) ' + buttonLabel
    statusItem.tooltip = 'Open saved commands'

    const quickPickCommandId = 'terminal-mate._quickPick'
    const quickPickDisposable = vscode.commands.registerCommand(quickPickCommandId, async () => {
      try {
        const addNewItem = {
          label: '$(add) Add new command',
          description: 'Save a new command to your list',
          alwaysShow: true,
        }

        const commandItems = customEntries
          .map((entry, idx) => ({ entry, idx }))
          .filter(({ entry }) => entry && typeof entry.title === 'string' && typeof entry.command === 'string' && entry.title.trim() && entry.command.trim())
          .map(({ entry, idx }) => ({
            label: entry.title.trim(),
            description: entry.command.trim(),
            idx,
            buttons: [
              { iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Edit this command' },
              { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete this command' },
            ],
          }))

        const qp = vscode.window.createQuickPick()
        qp.placeholder = 'Select a command to run'
        qp.items = [addNewItem, ...commandItems]

        const saveToConfig = async (updatedEntries) => {
          const cfg = getConfig()
          const saveToWorkspace = cfg.get('saveCommandsToWorkspace', false)
          const target =
            saveToWorkspace && vscode.workspace.workspaceFolders?.length
              ? vscode.ConfigurationTarget.Workspace
              : vscode.ConfigurationTarget.Global
          await vscode.workspace.getConfiguration('terminal-mate').update('customTerminals', updatedEntries, target)
        }

        qp.onDidTriggerItemButton(async ({ button, item }) => {
          qp.hide()
          const entry = customEntries[item.idx]
          if (!entry) return

          if (button.tooltip === 'Delete this command') {
            const confirm = await vscode.window.showWarningMessage(
              `TerminalMate: Are you sure you want to delete "${entry.title}"?`,
              { modal: true },
              'Delete'
            )
            if (confirm !== 'Delete') return

            const allEntries = [...(getConfig().get('customTerminals', []) || [])]
            allEntries.splice(item.idx, 1)
            await saveToConfig(allEntries)
            vscode.window.showInformationMessage(`TerminalMate: Command "${entry.title}" deleted.`)
            return
          }

          // Edit command
          const newTitle = await vscode.window.showInputBox({
            prompt: 'Edit command title',
            value: entry.title,
            validateInput: (v) => v?.trim() ? null : 'Title cannot be empty',
          })
          if (newTitle === undefined) return

          const newCommand = await vscode.window.showInputBox({
            prompt: 'Edit shell command',
            value: entry.command,
            validateInput: (v) => v?.trim() ? null : 'Command cannot be empty',
          })
          if (newCommand === undefined) return

          const allEntries = [...(getConfig().get('customTerminals', []) || [])]
          allEntries[item.idx] = { ...entry, title: newTitle.trim(), command: newCommand.trim() }
          await saveToConfig(allEntries)
          vscode.window.showInformationMessage(`TerminalMate: Command "${newTitle.trim()}" updated.`)
        })

        qp.onDidAccept(async () => {
          const [selected] = qp.selectedItems
          if (!selected) { qp.hide(); return }

          if (typeof selected.idx === 'undefined') {
            // "Add new command" selected
            qp.hide()
            const title = await vscode.window.showInputBox({
              prompt: 'Command title (shown as label)',
              placeHolder: 'e.g. Deploy',
              validateInput: (v) => v?.trim() ? null : 'Title cannot be empty',
            })
            if (!title?.trim()) return

            const command = await vscode.window.showInputBox({
              prompt: 'Shell command to run',
              placeHolder: 'e.g. npm run deploy',
              validateInput: (v) => v?.trim() ? null : 'Command cannot be empty',
            })
            if (!command?.trim()) return

            const allEntries = [...(getConfig().get('customTerminals', []) || [])]
            allEntries.push({ title: title.trim(), command: command.trim() })
            await saveToConfig(allEntries)
            vscode.window.showInformationMessage(`TerminalMate: Command "${title.trim()}" added.`)
            return
          }

          qp.hide()
          const entry = customEntries[selected.idx]
          if (!entry) return
          await runCustomEntry(entry)
          await updatePinned()
        })

        qp.onDidHide(() => qp.dispose())
        qp.show()
      } catch (error) {
        vscode.window.showErrorMessage(`TerminalMate: ${error.message}`)
      }
    })
    disposables.push(quickPickDisposable)
    // context.subscriptions.push(quickPickDisposable)
    // disposables.push(openCmd, runLastCmd)
    // context.subscriptions.push(openCmd, runLastCmd)

    statusItem.command = quickPickCommandId
    statusItem.show()
    statusItems.push(statusItem)
    context.subscriptions.push(statusItem)

    let pinnedItem = null

    const updatePinned = async () => {
      if (pinnedItem) {
        try { pinnedItem.dispose() } catch {}
        pinnedItem = null
      }
      const cfg = getConfig()
      const enabled = cfg.get('pinLastCustomTerminal', false)
      if (!enabled || !cachedLastCommand) return
      const prefix = (cfg.get('pinLastCustomTerminalLabelPrefix', '★') || '★').toString()
      pinnedItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, basePriority - 1)
      pinnedItem.text = `${prefix} ${cachedLastCommand.title}`
      pinnedItem.tooltip = `Run last custom: ${cachedLastCommand.command}`

      const pinCommandId = 'terminal-mate._runPinned'
      try {
        const existing = await vscode.commands.getCommands(true)
        if (!existing.includes(pinCommandId)) {
          const pinDisposable = vscode.commands.registerCommand(pinCommandId, async () => {
            try {
              await runCustomEntry(cachedLastCommand)
              await updatePinned()
            } catch (error) {
              vscode.window.showErrorMessage(`TerminalMate: ${error.message}`)
            }
          })
          disposables.push(pinDisposable)
          context.subscriptions.push(pinDisposable)
        }
      } catch {
        try {
          const pinDisposable = vscode.commands.registerCommand(pinCommandId, async () => {
            try {
              await runCustomEntry(cachedLastCommand)
              await updatePinned()
            } catch (error) {
              vscode.window.showErrorMessage(`TerminalMate: ${error.message}`)
            }
          })
          disposables.push(pinDisposable)
          context.subscriptions.push(pinDisposable)
        } catch {}
      }

      pinnedItem.command = pinCommandId
      pinnedItem.show()
      statusItems.push(pinnedItem)
      context.subscriptions.push(pinnedItem)
    }

    await updatePinned()

    return { updatePinned, quickPickCommandId }
  }

  const openCmd = vscode.commands.registerCommand('terminal-mate.openCommands', async () => {
    // We can't directy call buildCustomTerminalButtons internal quickPickCommandId easily 
    // unless we store it. Let's make it a fixed ID or similar.
    // Actually, buildCustomTerminalButtons defines it. Let's make it fixed.
    await vscode.commands.executeCommand('terminal-mate._quickPick')
  })
  const runLastCmd = vscode.commands.registerCommand('terminal-mate.runLastCommand', async () => {
    if (!cachedLastCommand) {
      vscode.window.showInformationMessage('No last custom command yet. Pick one first.')
      return
    }
    await runCustomEntry(cachedLastCommand)
    const res = await buildCustomTerminalButtons()
    if (res && res.updatePinned) res.updatePinned()
  })
  context.subscriptions.push(openCmd, runLastCmd)

  const finishSnippet = vscode.commands.registerCommand('terminal-mate.finishSnippet', async () => {
    if (!pendingSnippet) {
      vscode.window.showInformationMessage('No pending snippet.')
      return
    }
    try {
      const { terminal, suffix } = pendingSnippet
      if (!(await confirmDangerousIfNeeded(suffix))) return
      terminal.sendText(suffix)
    } finally {
      pendingSnippet = null
      if (finishStatusItem) finishStatusItem.hide()
    }
  })
  context.subscriptions.push(finishSnippet)

  const historyCommand = vscode.commands.registerCommand('terminal-mate.history', async () => {
    const history = context.globalState.get(GLOBAL_HISTORY_KEY, [])
    if (!history.length) {
      vscode.window.showInformationMessage('No history yet.')
      return
    }
    const picked = await vscode.window.showQuickPick(
      history.map((entry, idx) => ({ label: entry.title, description: entry.command, idx })),
      { placeHolder: 'Select a recent custom command to rerun' }
    )
    if (!picked) return
    const entry = history[picked.idx]
    const cfg = getConfig()
    const reuse = cfg.get('reuseTerminalByTitle', true)
    let terminal = reuse ? vscode.window.terminals.find((term) => term.name === entry.title) : null
    if (!terminal) terminal = vscode.window.createTerminal({ name: entry.title })
    terminal.show()
    terminal.sendText(entry.command)
  })
  context.subscriptions.push(historyCommand)

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration('terminal-mate.customTerminals') ||
      event.affectsConfiguration('terminal-mate.customTerminalsButtonLabel') ||
      event.affectsConfiguration('terminal-mate.pinLastCustomTerminal') ||
      event.affectsConfiguration('terminal-mate.pinLastCustomTerminalLabelPrefix') ||
      event.affectsConfiguration('terminal-mate.cursorSymbol') ||
      event.affectsConfiguration('terminal-mate.showPreviewForCustomTerminals') ||
      event.affectsConfiguration('terminal-mate.reuseTerminalByTitle') ||
      event.affectsConfiguration('terminal-mate.customHistorySize') ||
      event.affectsConfiguration('terminal-mate.confirmDangerousCommands') ||
      event.affectsConfiguration('terminal-mate.showStatusBar')
    ) {
      buildCustomTerminalButtons()
    }
  })
  context.subscriptions.push(onConfigChange)

  buildCustomTerminalButtons()

  return { buildCustomTerminalButtons }
}

module.exports = { registerTerminalMate }

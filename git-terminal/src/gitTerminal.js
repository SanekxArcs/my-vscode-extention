const vscode = require('vscode')
const { getConfig } = require('./config')

const GLOBAL_LAST_COMMAND_KEY = 'gitTerminal.lastCommand'
const GLOBAL_HISTORY_KEY = 'gitTerminal.history'

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

function registerGitTerminal(context) {
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

    const regex = /\$\{([^}]+)\}/g
    let match
    let output = ''
    let idx = 0
    while ((match = regex.exec(text)) !== null) {
      output += text.slice(idx, match.index)
      output += await replaceToken(match[0], match[1])
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
        finishStatusItem.command = 'gitTerminal.finishSnippet'
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

    const buttonLabel = (cfg.get('customTerminalsButtonLabel', 'git-c') || 'git-c').toString()
    const basePriority = 96
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, basePriority)
    statusItem.text = '$(terminal) ' + buttonLabel
    statusItem.tooltip = 'Open saved commands'

    const quickPickCommandId = 'gitTerminal._quickPick'
    const quickPickDisposable = vscode.commands.registerCommand(quickPickCommandId, async () => {
      try {
        const picks = customEntries
          .filter((entry) => entry && typeof entry.title === 'string' && typeof entry.command === 'string')
          .map((entry, idx) => ({ label: entry.title.trim(), description: entry.command.trim(), idx }))
          .filter((pick) => pick.label && pick.description)

        if (picks.length === 0) {
          vscode.window.showInformationMessage('No valid custom commands configured')
          return
        }

        const selected = await vscode.window.showQuickPick(picks, { placeHolder: 'Select a command to run' })
        if (!selected) return
        const entry = customEntries[selected.idx]
        await runCustomEntry(entry)
        await updatePinned()
      } catch (error) {
        vscode.window.showErrorMessage(`Git Terminal: ${error.message}`)
      }
    })
    disposables.push(quickPickDisposable)
    context.subscriptions.push(quickPickDisposable)

    const openCmd = vscode.commands.registerCommand('gitTerminal.openCommands', async () => {
      await vscode.commands.executeCommand(quickPickCommandId)
    })
    const runLastCmd = vscode.commands.registerCommand('gitTerminal.runLastCommand', async () => {
      if (!cachedLastCommand) {
        vscode.window.showInformationMessage('No last custom command yet. Pick one first.')
        return
      }
      await runCustomEntry(cachedLastCommand)
      await updatePinned()
    })
    disposables.push(openCmd, runLastCmd)
    context.subscriptions.push(openCmd, runLastCmd)

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

      const pinCommandId = 'gitTerminal._runPinned'
      try {
        const existing = await vscode.commands.getCommands(true)
        if (!existing.includes(pinCommandId)) {
          const pinDisposable = vscode.commands.registerCommand(pinCommandId, async () => {
            try {
              await runCustomEntry(cachedLastCommand)
              await updatePinned()
            } catch (error) {
              vscode.window.showErrorMessage(`Git Terminal: ${error.message}`)
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
              vscode.window.showErrorMessage(`Git Terminal: ${error.message}`)
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

    return { updatePinned }
  }

  const finishSnippet = vscode.commands.registerCommand('gitTerminal.finishSnippet', async () => {
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

  const historyCommand = vscode.commands.registerCommand('gitTerminal.history', async () => {
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
      event.affectsConfiguration('gitTerminal.customTerminals') ||
      event.affectsConfiguration('gitTerminal.customTerminalsButtonLabel') ||
      event.affectsConfiguration('gitTerminal.pinLastCustomTerminal') ||
      event.affectsConfiguration('gitTerminal.pinLastCustomTerminalLabelPrefix') ||
      event.affectsConfiguration('gitTerminal.cursorSymbol') ||
      event.affectsConfiguration('gitTerminal.showPreviewForCustomTerminals') ||
      event.affectsConfiguration('gitTerminal.reuseTerminalByTitle') ||
      event.affectsConfiguration('gitTerminal.customHistorySize') ||
      event.affectsConfiguration('gitTerminal.confirmDangerousCommands') ||
      event.affectsConfiguration('gitTerminal.showStatusBar')
    ) {
      buildCustomTerminalButtons()
    }
  })
  context.subscriptions.push(onConfigChange)

  buildCustomTerminalButtons()

  return { buildCustomTerminalButtons }
}

module.exports = { registerGitTerminal }

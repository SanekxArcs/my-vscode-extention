const vscode = require('vscode')
const { getConfig } = require('./config')

function shellEscapePosix(s) {
  if (s == null) return ''
  return `'${String(s).replace(/'/g, `'+"'"+'`)}'`
}

function normalizeOs(os) {
  const map = { win32: 'win32', windows: 'win32', darwin: 'darwin', mac: 'darwin', macos: 'darwin', linux: 'linux' }
  const v = String(os || '').toLowerCase()
  return map[v] || v
}

function registerGitShortcuts(context) {
  let customButtons = []
  let customCommands = []
  let finishStatusItem = null
  let pendingSnippet = null // { terminal, suffix }

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

    const resolvePlaceholders = async (template, folder) => {
      const cfg = getConfig()
      const cursorSymbol = cfg.get('cursorSymbol', '<|>') || '<|>'
      const cache = new Map()
      let text = template

      const clipboardText = await vscode.env.clipboard.readText()
      const replacements = async (match, body) => {
        if (body.startsWith('input:')) {
          const label = body.slice('input:'.length)
          if (cache.has(match)) return cache.get(match)
          const value = await vscode.window.showInputBox({ prompt: label })
          const escaped = shellEscapePosix(value ?? '')
          cache.set(match, escaped)
          return escaped
        }
        if (body.startsWith('pick:')) {
          const rest = body.slice('pick:'.length)
          const [label, ...opts] = rest.split('|')
          const picked = await vscode.window.showQuickPick(opts, { placeHolder: label })
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

      const re = /\$\{([^}]+)\}/g
      let m
      let out = ''
      let idx = 0
      while ((m = re.exec(text))) {
        out += text.slice(idx, m.index)
        out += await replacements(m[0], m[1])
        idx = m.index + m[0].length
      }
      out += text.slice(idx)

      return { result: out, cursorSymbol }
    }

    const showPreviewIfNeeded = async (cmd) => {
      const showPrev = cfg.get('showPreviewForCustomTerminals', false)
      if (!showPrev) return true
      const pick = await vscode.window.showInformationMessage(`Run: ${cmd}`, { modal: true }, 'Run')
      return pick === 'Run'
    }

    const pushHistory = async (title, command) => {
      const size = Math.max(0, Number(cfg.get('customHistorySize', 10)) || 10)
      const key = 'runScript.customHistory'
      const hist = context.globalState.get(key, [])
      hist.unshift({ title, command, at: Date.now() })
      while (hist.length > size) hist.pop()
      await context.globalState.update(key, hist)
    }

    const runCustomEntry = async (entry) => {
      const title = (entry.title || '').trim()
      let template = (entry.command || '').trim()
      if (!title || !template) return

      // OS filter
      if (entry.os) {
        const osList = Array.isArray(entry.os) ? entry.os : [entry.os]
        const normalized = osList.map(normalizeOs)
        const current = process.platform
        if (!normalized.includes(current)) return
      }

      const folder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor?.document?.uri) || workspaceFolder
      const { result, cursorSymbol } = await resolvePlaceholders(template, folder)

      const reuseSetting = cfg.get('reuseTerminalByTitle', true)
      const reuse = typeof entry.reuse === 'boolean' ? entry.reuse : reuseSetting
      const cwd = entry.cwd || folder?.uri.fsPath

      let terminal = reuse ? vscode.window.terminals.find(t => t.name === title) : null
      if (!terminal) terminal = vscode.window.createTerminal({ name: title, cwd })
      terminal.show()

      if (result.includes(cursorSymbol)) {
        const [head, tail] = result.split(cursorSymbol)
        terminal.sendText(head, false) // no newline
        pendingSnippet = { terminal, suffix: tail }
        if (!finishStatusItem) {
          finishStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95)
          finishStatusItem.text = '$(arrow-right) Finish snippet'
          finishStatusItem.command = 'extension.customTerminal.finishSnippet'
          finishStatusItem.tooltip = 'Finish current custom snippet'
          context.subscriptions.push(finishStatusItem)
        }
        finishStatusItem.show()
      } else {
        if (!(await showPreviewIfNeeded(result))) return
        terminal.sendText(result)
        await pushHistory(title, result)
      }

      lastPicked = { title, command: template }
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

  // Finish snippet command
  const finishSnippet = vscode.commands.registerCommand('extension.customTerminal.finishSnippet', async () => {
    if (!pendingSnippet) { vscode.window.showInformationMessage('No pending snippet.'); return }
    try {
      const { terminal, suffix } = pendingSnippet
      terminal.sendText(suffix)
    } finally {
      pendingSnippet = null
      if (finishStatusItem) finishStatusItem.hide()
    }
  })
  customCommands.push(finishSnippet)
  context.subscriptions.push(finishSnippet)

  // History quick pick command
  const openHistory = vscode.commands.registerCommand('extension.customTerminal.history', async () => {
    const key = 'runScript.customHistory'
    const hist = context.globalState.get(key, [])
    if (!hist.length) { vscode.window.showInformationMessage('No history yet.'); return }
    const picked = await vscode.window.showQuickPick(
      hist.map((h, idx) => ({ label: h.title, description: h.command, idx })),
      { placeHolder: 'Select a recent custom command to rerun' }
    )
    if (!picked) return
    const entry = hist[picked.idx]
    const title = entry.title
    const cmd = entry.command
    const cfg = getConfig()
    const reuse = cfg.get('reuseTerminalByTitle', true)
    let terminal = reuse ? vscode.window.terminals.find(t => t.name === title) : null
    if (!terminal) terminal = vscode.window.createTerminal({ name: title })
    terminal.show()
    terminal.sendText(cmd)
  })
  customCommands.push(openHistory)
  context.subscriptions.push(openHistory)

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration('runScript.customTerminals') ||
      e.affectsConfiguration('runScript.customTerminalsButtonLabel') ||
      e.affectsConfiguration('runScript.pinLastCustomTerminal') ||
      e.affectsConfiguration('runScript.pinLastCustomTerminalLabelPrefix') ||
      e.affectsConfiguration('runScript.cursorSymbol') ||
      e.affectsConfiguration('runScript.showPreviewForCustomTerminals') ||
      e.affectsConfiguration('runScript.reuseTerminalByTitle') ||
      e.affectsConfiguration('runScript.customHistorySize')
    ) {
      buildCustomTerminalButtons()
    }
  })
  context.subscriptions.push(onConfigChange)

  buildCustomTerminalButtons()

  return { buildCustomTerminalButtons, clearCustomButtons }
}

module.exports = { registerGitShortcuts }

const vscode = require('vscode')
const { getConfig } = require('./config')
const {
  hasText,
  isChain,
  isValidEntry,
  describeEntry,
  loadEntries,
  saveEntries,
  findByTitle,
  expandChain,
} = require('./entries')

const GLOBAL_LAST_COMMAND_KEY = 'terminal-mate.lastCommand'
const GLOBAL_HISTORY_KEY = 'terminal-mate.history'
const GLOBAL_USAGE_KEY = 'terminal-mate.usage'
const QUICK_PICK_COMMAND_ID = 'terminal-mate._quickPick'
const PIN_COMMAND_ID = 'terminal-mate._runPinned'
const STATUS_PRIORITY = 96
const SHELL_INTEGRATION_WAIT_MS = 3000

// Keep in sync with the default of "terminal-mate.dangerousCommandPatterns" in package.json
const DEFAULT_DANGEROUS_PATTERNS = [
  'git\\s+reset\\s+--hard',
  'git\\s+clean[\\s\\S]*(-fd|--force)',
  'git\\s+push[\\s\\S]*\\s(-f|--force)(\\s|$)',
]

const BUTTONS = {
  up: { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: 'Move up' },
  down: { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: 'Move down' },
  schedule: { iconPath: new vscode.ThemeIcon('clock'), tooltip: 'Schedule this command' },
  edit: { iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Edit, duplicate, shortcut…' },
  archive: { iconPath: new vscode.ThemeIcon('archive'), tooltip: 'Archive this command' },
  restore: { iconPath: new vscode.ThemeIcon('reply'), tooltip: 'Restore from archive' },
  remove: { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete this command' },
}

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

function matchesOs(entry) {
  if (!entry.os) return true
  const osList = Array.isArray(entry.os) ? entry.os : [entry.os]
  return osList.map(normalizeOs).includes(process.platform)
}

const groupOf = (entry) => (hasText(entry.group) ? entry.group.trim() : '')

function registerTerminalMate(context) {
  let statusItems = []
  let pinnedItem = null
  let finishStatusItem = null
  let pendingSnippet = null // { terminal, suffix }
  let cachedLastCommand = context.globalState.get(GLOBAL_LAST_COMMAND_KEY) || null

  const needsConfirmation = (command) => {
    if (!command) return false
    const configured = getConfig().get('dangerousCommandPatterns', DEFAULT_DANGEROUS_PATTERNS)
    const patterns = Array.isArray(configured) ? configured : DEFAULT_DANGEROUS_PATTERNS
    return patterns.some((pattern) => {
      if (!hasText(pattern)) return false
      try {
        return new RegExp(pattern, 'i').test(command)
      } catch {
        return false // an invalid pattern in settings must not block every command
      }
    })
  }

  const confirmDangerousIfNeeded = async (command) => {
    const cfg = getConfig()
    if (!cfg.get('confirmDangerousCommands', true)) return true
    if (!needsConfirmation(command)) return true
    const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
      placeHolder: `This command looks dangerous. Continue? ${command}`,
    })
    return answer === 'Yes'
  }

  const pushHistory = async (title, command, cwd) => {
    const cfg = getConfig()
    const size = Math.max(0, Number(cfg.get('customHistorySize', 10)) || 10)
    const history = context.globalState.get(GLOBAL_HISTORY_KEY, [])
    history.unshift({ title, command, cwd: cwd || null, at: Date.now() })
    while (history.length > size) history.pop()
    await context.globalState.update(GLOBAL_HISTORY_KEY, history)
  }

  const recordUsage = async (title) => {
    const usage = { ...context.globalState.get(GLOBAL_USAGE_KEY, {}) }
    usage[title] = { count: (usage[title]?.count || 0) + 1, last: Date.now() }
    await context.globalState.update(GLOBAL_USAGE_KEY, usage)
  }

  const rememberLast = async (entry) => {
    const { archived: _archived, ...rest } = entry
    cachedLastCommand = rest
    await context.globalState.update(GLOBAL_LAST_COMMAND_KEY, cachedLastCommand)
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

  // Turns an entry into the final commands to run; a chain becomes one step per command
  const resolveSteps = async (entry, folder) => {
    const plain = isChain(entry) ? expandChain(entry, loadEntries()).filter(matchesOs) : [entry]
    const steps = []
    for (const step of plain) {
      const { result, cursorSymbol } = await resolvePlaceholders(step.command.trim(), folder)
      steps.push({ title: step.title.trim(), command: result, cursorSymbol, hasCursor: result.includes(cursorSymbol) })
    }
    return steps
  }

  const showPreviewIfNeeded = async (command) => {
    const cfg = getConfig()
    if (!cfg.get('showPreviewForCustomTerminals', false)) return true
    const choice = await vscode.window.showInformationMessage(`Run: ${command}`, { modal: true }, 'Run')
    return choice === 'Run'
  }

  const getActiveFolder = () => {
    let folder = null
    try {
      const activeDoc = vscode.window.activeTextEditor?.document
      if (activeDoc && activeDoc.uri) {
        folder = vscode.workspace.getWorkspaceFolder(activeDoc.uri)
      }
    } catch {}
    return folder || vscode.workspace.workspaceFolders?.[0] || null
  }

  const getTerminal = (name, cwd, reuse) => {
    let terminal = reuse ? vscode.window.terminals.find((term) => term.name === name) : null
    if (!terminal) terminal = vscode.window.createTerminal({ name, cwd: cwd || undefined })
    return terminal
  }

  // Shell integration (VS Code 1.93+) reports when a command ends and its exit code.
  // A new terminal needs a moment before it is available; null means "not available".
  const waitForShellIntegration = (terminal) => {
    if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration)
    if (!vscode.window.onDidChangeTerminalShellIntegration) return Promise.resolve(null)
    return new Promise((resolve) => {
      let timer = null
      const sub = vscode.window.onDidChangeTerminalShellIntegration((event) => {
        if (event.terminal !== terminal) return
        clearTimeout(timer)
        sub.dispose()
        resolve(event.shellIntegration)
      })
      timer = setTimeout(() => {
        sub.dispose()
        resolve(null)
      }, SHELL_INTEGRATION_WAIT_MS)
    })
  }

  // Runs steps one after another in the same terminal and stops at the first failure.
  // Without shell integration the commands are simply sent in order, with no failure check.
  const runSequence = async (terminal, steps, title) => {
    const integration = await waitForShellIntegration(terminal)
    const canWait = Boolean(integration && vscode.window.onDidEndTerminalShellExecution)
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (!canWait) {
        terminal.sendText(step.command)
        continue
      }
      const exitCode = await new Promise((resolve) => {
        let execution = null
        const finish = (code) => {
          endSub.dispose()
          closeSub.dispose()
          resolve(code)
        }
        const endSub = vscode.window.onDidEndTerminalShellExecution((event) => {
          if (event.execution === execution) finish(event.exitCode)
        })
        const closeSub = vscode.window.onDidCloseTerminal((closed) => {
          if (closed === terminal) finish(null)
        })
        execution = integration.executeCommand(step.command)
      })
      if (exitCode === null) {
        vscode.window.showWarningMessage(`TerminalMate: "${title}" stopped at step ${i + 1} of ${steps.length}: the terminal was closed.`)
        return false
      }
      if (exitCode) {
        vscode.window.showWarningMessage(
          `TerminalMate: "${title}" stopped at step ${i + 1} of ${steps.length} ("${step.title}", exit code ${exitCode}).`
        )
        return false
      }
    }
    if (canWait && steps.length > 1) vscode.window.setStatusBarMessage(`TerminalMate: "${title}" finished`, 5000)
    return true
  }

  const runCustomEntry = async (entry) => {
    if (!isValidEntry(entry)) return
    if (!matchesOs(entry)) return
    const title = entry.title.trim()

    const folder = getActiveFolder()
    const cfg = getConfig()
    const reuseSetting = cfg.get('reuseTerminalByTitle', true)
    const reuse = typeof entry.reuse === 'boolean' ? entry.reuse : reuseSetting
    const cwd = entry.cwd || folder?.uri?.fsPath || process.cwd()

    const steps = await resolveSteps(entry, folder)
    if (!steps.length) {
      vscode.window.showWarningMessage(`TerminalMate: "${title}" has no steps for this operating system.`)
      return
    }

    if (isChain(entry)) {
      if (steps.some((step) => step.hasCursor)) {
        vscode.window.showWarningMessage('TerminalMate: A chain cannot contain snippets with a cursor marker.')
        return
      }
      for (const step of steps) {
        if (!(await confirmDangerousIfNeeded(step.command))) return
      }
      if (!(await showPreviewIfNeeded(steps.map((step) => step.command).join('\n')))) return

      const terminal = getTerminal(title, cwd, reuse)
      terminal.show()
      for (const step of [...steps].reverse()) await pushHistory(`${title} › ${step.title}`, step.command, cwd)
      await recordUsage(title)
      await rememberLast(entry)
      // Not awaited: a chain can take minutes and the caller should not hang on it
      runSequence(terminal, steps, title).catch((error) =>
        vscode.window.showErrorMessage(`TerminalMate: "${title}" failed: ${error.message}`)
      )
      return
    }

    const { command: result, cursorSymbol, hasCursor } = steps[0]
    if (hasCursor) {
      const terminal = getTerminal(title, cwd, reuse)
      terminal.show()
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
      const terminal = getTerminal(title, cwd, reuse)
      terminal.show()
      terminal.sendText(result)
      await pushHistory(title, result, cwd)
    }

    await recordUsage(title)
    await rememberLast(entry)
  }

  const updatePinned = () => {
    if (pinnedItem) {
      try { pinnedItem.dispose() } catch {}
      pinnedItem = null
    }
    const cfg = getConfig()
    if (!cfg.get('showStatusBar', true) || !cfg.get('pinLastCustomTerminal', false)) return
    if (!isValidEntry(cachedLastCommand)) return
    const prefix = (cfg.get('pinLastCustomTerminalLabelPrefix', '★') || '★').toString()
    pinnedItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, STATUS_PRIORITY - 1)
    pinnedItem.text = `${prefix} ${cachedLastCommand.title}`
    pinnedItem.tooltip = `Run last custom: ${describeEntry(cachedLastCommand)}`
    pinnedItem.command = PIN_COMMAND_ID
    pinnedItem.show()
  }

  const buildCustomTerminalButtons = () => {
    for (const item of statusItems) {
      try { item.dispose() } catch {}
    }
    statusItems = []

    const cfg = getConfig()
    if (cfg.get('showStatusBar', true)) {
      const buttonLabel = (cfg.get('customTerminalsButtonLabel', 'TM') || 'TM').toString()
      const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, STATUS_PRIORITY)
      statusItem.text = '$(terminal) ' + buttonLabel
      statusItem.tooltip = 'Open saved commands'
      statusItem.command = QUICK_PICK_COMMAND_ID
      statusItem.show()
      statusItems.push(statusItem)
    }
    updatePinned()
  }

  const askTitle = (options) =>
    vscode.window.showInputBox({ validateInput: (v) => (v?.trim() ? null : 'Title cannot be empty'), ...options })

  const askCommand = (options) =>
    vscode.window.showInputBox({ validateInput: (v) => (v?.trim() ? null : 'Command cannot be empty'), ...options })

  // Steps are picked one at a time so their order is exactly the order you chose
  const pickChainSteps = async (ownTitle, initial = []) => {
    const steps = [...initial]
    while (true) {
      const candidates = loadEntries().filter(
        (entry) => isValidEntry(entry) && !entry.archived && entry.title.trim() !== ownTitle
      )
      if (!candidates.length) {
        vscode.window.showInformationMessage('TerminalMate: Save at least one command first, then build a chain from it.')
        return null
      }
      const picked = await vscode.window.showQuickPick(
        [
          ...(steps.length
            ? [
                { label: `$(check) Done — ${steps.length} step(s)`, description: steps.join(' → '), action: 'done' },
                { label: '$(discard) Remove last step', description: steps[steps.length - 1], action: 'undo' },
              ]
            : []),
          ...candidates.map((entry) => ({ label: entry.title.trim(), description: describeEntry(entry), step: entry.title.trim() })),
        ],
        { placeHolder: steps.length ? `Pick step ${steps.length + 1}, or choose Done` : 'Pick the first step of the chain' }
      )
      if (!picked) return null
      if (picked.action === 'done') return steps
      if (picked.action === 'undo') steps.pop()
      else steps.push(picked.step)
    }
  }

  const pickGroup = async (entry) => {
    const groups = [...new Set(loadEntries().filter(isValidEntry).map(groupOf).filter(Boolean))]
    const picked = await vscode.window.showQuickPick(
      [
        { label: '$(add) New group…', action: 'new' },
        ...(groupOf(entry) ? [{ label: '$(close) No group', action: 'none' }] : []),
        ...groups.map((group) => ({ label: group, group })),
      ],
      { placeHolder: `Group for "${entry.title}"` }
    )
    if (!picked) return undefined
    if (picked.action === 'none') return ''
    if (picked.action === 'new') {
      const name = await vscode.window.showInputBox({ prompt: 'Group name', placeHolder: 'e.g. git' })
      return name?.trim() ? name.trim() : undefined
    }
    return picked.group
  }

  const openSettingsJson = async () => {
    const workspace = getConfig().get('saveCommandsToWorkspace', false) && vscode.workspace.workspaceFolders?.length
    await vscode.commands.executeCommand(
      workspace ? 'workbench.action.openWorkspaceSettingsFile' : 'workbench.action.openSettingsJson',
      { revealSetting: { key: 'terminal-mate.customTerminals' } }
    )
  }

  // A small menu that reopens after each change, until Escape
  const editEntry = async (startIdx) => {
    let idx = startIdx
    while (true) {
      const all = [...loadEntries()]
      const entry = all[idx]
      if (!isValidEntry(entry)) return
      const chain = isChain(entry)

      const picked = await vscode.window.showQuickPick(
        [
          { label: '$(tag) Title', description: entry.title, field: 'title' },
          chain
            ? { label: '$(list-ordered) Steps', description: entry.chain.filter(hasText).join(' → '), field: 'chain' }
            : { label: '$(terminal) Command', description: entry.command, field: 'command' },
          { label: '$(folder) Working directory', description: entry.cwd || 'workspace folder', field: 'cwd' },
          { label: '$(symbol-folder) Group', description: groupOf(entry) || 'none', field: 'group' },
          { label: '$(copy) Duplicate', description: 'Make a copy and edit it', field: 'duplicate' },
          { label: '$(keyboard) Keyboard shortcut', description: 'Copy a keybinding and open keybindings.json', field: 'shortcut' },
          { label: '$(json) Open in settings.json', description: 'For os, reuse and manual edits', field: 'settings' },
        ],
        { placeHolder: `Edit "${entry.title}" — press Escape when done` }
      )
      if (!picked) return

      const save = async (updated) => {
        all[idx] = updated
        await saveEntries(all)
        if (cachedLastCommand?.title === entry.title) await rememberLast(updated)
        updatePinned()
      }

      if (picked.field === 'title') {
        const value = await askTitle({ prompt: 'Edit command title', value: entry.title })
        if (value === undefined || value.trim() === entry.title) continue
        const title = value.trim()
        // Chains refer to their steps by title, so they follow the rename
        for (let i = 0; i < all.length; i++) {
          if (i !== idx && isChain(all[i])) {
            all[i] = { ...all[i], chain: all[i].chain.map((step) => (hasText(step) && step.trim() === entry.title.trim() ? title : step)) }
          }
        }
        const usage = { ...context.globalState.get(GLOBAL_USAGE_KEY, {}) }
        if (usage[entry.title.trim()]) {
          usage[title] = usage[entry.title.trim()]
          delete usage[entry.title.trim()]
          await context.globalState.update(GLOBAL_USAGE_KEY, usage)
        }
        await save({ ...entry, title })
      } else if (picked.field === 'command') {
        const value = await askCommand({ prompt: 'Edit shell command', value: entry.command })
        if (value === undefined) continue
        await save({ ...entry, command: value.trim() })
      } else if (picked.field === 'chain') {
        const steps = await pickChainSteps(entry.title.trim(), entry.chain.filter(hasText))
        if (!steps) continue
        await save({ ...entry, chain: steps })
      } else if (picked.field === 'cwd') {
        const value = await vscode.window.showInputBox({
          prompt: 'Working directory (leave empty to use the workspace folder)',
          value: entry.cwd || '',
        })
        if (value === undefined) continue
        const { cwd: _cwd, ...rest } = entry
        await save(value.trim() ? { ...rest, cwd: value.trim() } : rest)
      } else if (picked.field === 'group') {
        const group = await pickGroup(entry)
        if (group === undefined) continue
        const { group: _group, ...rest } = entry
        await save(group ? { ...rest, group } : rest)
      } else if (picked.field === 'duplicate') {
        const titles = new Set(all.filter(isValidEntry).map((item) => item.title.trim()))
        let title = `${entry.title.trim()} copy`
        for (let n = 2; titles.has(title); n++) title = `${entry.title.trim()} copy ${n}`
        all.splice(idx + 1, 0, { ...entry, title })
        await saveEntries(all)
        idx += 1 // keep editing the copy
      } else if (picked.field === 'shortcut') {
        const snippet = JSON.stringify({ key: 'ctrl+alt+1', command: 'terminal-mate.run', args: entry.title.trim() }, null, 2)
        await vscode.env.clipboard.writeText(snippet)
        await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile')
        vscode.window.showInformationMessage(
          `TerminalMate: Keybinding for "${entry.title}" copied. Paste it into keybindings.json and change "key".`
        )
        return
      } else if (picked.field === 'settings') {
        await openSettingsJson()
        return
      }
    }
  }

  const addCommand = async () => {
    const title = await askTitle({ prompt: 'Command title (shown as label)', placeHolder: 'e.g. Deploy' })
    if (!title?.trim()) return
    const command = await askCommand({ prompt: 'Shell command to run', placeHolder: 'e.g. npm run deploy' })
    if (!command?.trim()) return
    await saveEntries([...loadEntries(), { title: title.trim(), command: command.trim() }])
    vscode.window.showInformationMessage(`TerminalMate: Command "${title.trim()}" added.`)
  }

  const addChain = async () => {
    const title = await askTitle({ prompt: 'Chain title (shown as label)', placeHolder: 'e.g. Build and deploy' })
    if (!title?.trim()) return
    const steps = await pickChainSteps(title.trim())
    if (!steps) return
    await saveEntries([...loadEntries(), { title: title.trim(), chain: steps }])
    vscode.window.showInformationMessage(`TerminalMate: Chain "${title.trim()}" added (${steps.join(' → ')}).`)
  }

  const openPicker = () => {
    const sortMode = getConfig().get('sortCommands', 'manual')
    const manualOrder = sortMode !== 'recent' && sortMode !== 'frequent'
    const usage = context.globalState.get(GLOBAL_USAGE_KEY, {})
    const usageOf = (entry) => usage[entry.title.trim()] || { count: 0, last: 0 }
    const byUsage = (a, b) => {
      const ua = usageOf(a.entry)
      const ub = usageOf(b.entry)
      if (sortMode === 'frequent' && ua.count !== ub.count) return ub.count - ua.count
      return ub.last - ua.last
    }

    const addNewItem = { label: '$(add) Add new command', description: 'Save a new command to your list', alwaysShow: true, action: 'add' }
    const addChainItem = { label: '$(list-ordered) Add new chain', description: 'Run several saved commands in a row', action: 'addChain' }
    const backItem = { label: '$(arrow-left) Back to commands', alwaysShow: true, action: 'back' }
    const separator = (label = '') => ({ label, kind: vscode.QuickPickItemKind.Separator })

    let entries = [...loadEntries()]
    let view = 'main' // 'main' | 'archive'
    const isInView = (entry) => isValidEntry(entry) && Boolean(entry.archived) === (view === 'archive')

    // Ungrouped commands first, then each group in the order it first appears in settings
    const buildSections = () => {
      const sections = new Map([['', []]])
      entries.forEach((entry, idx) => {
        if (!isInView(entry)) return
        const key = view === 'archive' ? '' : groupOf(entry)
        if (!sections.has(key)) sections.set(key, [])
        sections.get(key).push({ entry, idx })
      })
      if (view === 'main' && !manualOrder) for (const rows of sections.values()) rows.sort(byUsage)
      return sections
    }

    const qp = vscode.window.createQuickPick()
    qp.keepScrollPosition = true

    // Rebuilds the list for the current view; returns the command items
    const render = () => {
      const commandItems = []
      const rows = []
      for (const [group, sectionRows] of buildSections()) {
        if (!sectionRows.length) continue
        if (group) rows.push(separator(group))
        sectionRows.forEach(({ entry, idx }, pos) => {
          const item = {
            label: entry.title.trim(),
            description: describeEntry(entry),
            idx,
            buttons:
              view === 'archive'
                ? [BUTTONS.restore, BUTTONS.remove]
                : [
                    ...(manualOrder && pos > 0 ? [BUTTONS.up] : []),
                    ...(manualOrder && pos < sectionRows.length - 1 ? [BUTTONS.down] : []),
                    BUTTONS.schedule,
                    BUTTONS.edit,
                    BUTTONS.archive,
                    BUTTONS.remove,
                  ],
          }
          rows.push(item)
          commandItems.push(item)
        })
      }

      if (view === 'archive') {
        qp.placeholder = 'Archived commands — Enter restores the selected one'
        qp.items = [backItem, ...rows]
        return commandItems
      }

      const archivedCount = entries.filter((entry) => isValidEntry(entry) && entry.archived).length
      const footer = [separator(), addChainItem]
      if (archivedCount) {
        footer.push({
          label: `$(archive) Archive (${archivedCount})`,
          description: 'Show archived commands',
          alwaysShow: true,
          action: 'openArchive',
        })
      }
      qp.placeholder = 'Select a command to run'
      qp.items = [addNewItem, ...rows, ...footer]
      return commandItems
    }

    const switchView = (nextView) => {
      view = nextView
      qp.value = ''
      render()
    }

    // Reorders and archive changes are saved in sequence so quick repeated clicks don't race each other
    let pendingSave = Promise.resolve()
    const queueSave = () => {
      const snapshot = entries
      pendingSave = pendingSave
        .then(() => saveEntries(snapshot))
        .catch((error) => vscode.window.showErrorMessage(`TerminalMate: ${error.message}`))
    }

    // Moves a command within its own group
    const moveEntry = (item, direction) => {
      const section = [...buildSections().values()].find((rows) => rows.some((row) => row.idx === item.idx))
      if (!section) return
      const pos = section.findIndex((row) => row.idx === item.idx)
      const neighbor = section[pos + direction]?.idx
      if (neighbor === undefined) return

      entries = [...entries]
      ;[entries[item.idx], entries[neighbor]] = [entries[neighbor], entries[item.idx]]

      const moved = render().find((i) => i.idx === neighbor)
      if (moved) qp.activeItems = [moved]
      queueSave()
    }

    // The picker stays open, so several commands can be archived or restored in a row
    const setArchived = (item, archived) => {
      const entry = entries[item.idx]
      if (!entry) return
      const { archived: _removed, ...rest } = entry
      entries = [...entries]
      entries[item.idx] = archived ? { ...rest, archived: true } : rest

      const pos = qp.items.filter((i) => typeof i.idx === 'number').findIndex((i) => i.idx === item.idx)
      const commandItems = render()
      if (view === 'archive' && !commandItems.length) {
        switchView('main')
      } else {
        const next = commandItems[Math.min(Math.max(pos, 0), commandItems.length - 1)]
        if (next) qp.activeItems = [next]
      }
      queueSave()
    }

    qp.onDidTriggerItemButton(async ({ button, item }) => {
      try {
        const action = button.tooltip
        if (action === BUTTONS.up.tooltip || action === BUTTONS.down.tooltip) {
          moveEntry(item, action === BUTTONS.up.tooltip ? -1 : 1)
          return
        }
        if (action === BUTTONS.archive.tooltip || action === BUTTONS.restore.tooltip) {
          setArchived(item, action === BUTTONS.archive.tooltip)
          return
        }

        qp.hide()
        await pendingSave
        const entry = entries[item.idx]
        if (!entry) return

        if (action === BUTTONS.schedule.tooltip) {
          await vscode.commands.executeCommand('terminal-mate.scheduleCommand', entry)
          return
        }

        if (action === BUTTONS.remove.tooltip) {
          const confirm = await vscode.window.showWarningMessage(
            `TerminalMate: Are you sure you want to delete "${entry.title}"?`,
            { modal: true },
            'Delete'
          )
          if (confirm !== 'Delete') return
          const allEntries = [...loadEntries()]
          allEntries.splice(item.idx, 1)
          await saveEntries(allEntries)
          vscode.window.showInformationMessage(`TerminalMate: Command "${entry.title}" deleted.`)
          return
        }

        await editEntry(item.idx)
      } catch (error) {
        vscode.window.showErrorMessage(`TerminalMate: ${error.message}`)
      }
    })

    qp.onDidAccept(async () => {
      try {
        const [selected] = qp.selectedItems
        if (!selected) { qp.hide(); return }

        if (selected.action === 'openArchive' || selected.action === 'back') {
          switchView(selected.action === 'openArchive' ? 'archive' : 'main')
          return
        }

        if (view === 'archive') {
          if (typeof selected.idx === 'number') setArchived(selected, false)
          return
        }

        qp.hide()
        await pendingSave

        if (selected.action === 'add') { await addCommand(); return }
        if (selected.action === 'addChain') { await addChain(); return }

        const entry = entries[selected.idx]
        if (!entry) return
        await runCustomEntry(entry)
        updatePinned()
      } catch (error) {
        vscode.window.showErrorMessage(`TerminalMate: ${error.message}`)
      }
    })

    qp.onDidHide(() => qp.dispose())
    render()
    qp.show()
  }

  const runLast = async () => {
    if (!isValidEntry(cachedLastCommand)) {
      vscode.window.showInformationMessage('No last custom command yet. Pick one first.')
      return
    }
    await runCustomEntry(cachedLastCommand)
    updatePinned()
  }

  // Shows errors instead of letting a command fail silently
  const guarded = (handler) => async (...args) => {
    try {
      await handler(...args)
    } catch (error) {
      vscode.window.showErrorMessage(`TerminalMate: ${error.message}`)
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(QUICK_PICK_COMMAND_ID, guarded(openPicker)),
    vscode.commands.registerCommand('terminal-mate.openCommands', guarded(openPicker)),
    vscode.commands.registerCommand(PIN_COMMAND_ID, guarded(runLast)),
    vscode.commands.registerCommand('terminal-mate.runLastCommand', guarded(runLast)),
    // For keybindings.json: { "key": "…", "command": "terminal-mate.run", "args": "Command title" }
    vscode.commands.registerCommand(
      'terminal-mate.run',
      guarded(async (arg) => {
        const title = typeof arg === 'string' ? arg : arg?.title
        if (!hasText(title)) {
          openPicker()
          return
        }
        const entry = findByTitle(loadEntries(), title)
        if (!entry) {
          vscode.window.showWarningMessage(`TerminalMate: No saved command titled "${title}".`)
          return
        }
        await runCustomEntry(entry)
        updatePinned()
      })
    ),
    { dispose: () => {
      for (const item of [...statusItems, pinnedItem]) {
        try { item?.dispose() } catch {}
      }
    } }
  )

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

  const historyCommand = vscode.commands.registerCommand(
    'terminal-mate.history',
    guarded(async () => {
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
      // Same checks as a normal run: history holds final commands, placeholders already filled in
      if (!(await confirmDangerousIfNeeded(entry.command))) return
      if (!(await showPreviewIfNeeded(entry.command))) return
      const terminal = getTerminal(entry.title, entry.cwd, getConfig().get('reuseTerminalByTitle', true))
      terminal.show()
      terminal.sendText(entry.command)
    })
  )
  context.subscriptions.push(historyCommand)

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration('terminal-mate.customTerminalsButtonLabel') ||
      event.affectsConfiguration('terminal-mate.pinLastCustomTerminal') ||
      event.affectsConfiguration('terminal-mate.pinLastCustomTerminalLabelPrefix') ||
      event.affectsConfiguration('terminal-mate.showStatusBar')
    ) {
      buildCustomTerminalButtons()
    }
  })
  context.subscriptions.push(onConfigChange)

  buildCustomTerminalButtons()

  return {
    resolveSteps,
    confirmDangerousIfNeeded,
    pushHistory,
    getActiveFolder,
    runSequence,
  }
}

module.exports = { registerTerminalMate }

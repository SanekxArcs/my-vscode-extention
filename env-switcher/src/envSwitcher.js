const vscode = require('vscode')
const path = require('path')
const os = require('os')
const { TextDecoder, TextEncoder } = require('util')
const { getConfig } = require('./config')

const decoder = new TextDecoder('utf8')
const encoder = new TextEncoder()

function expandHomePath(targetPath) {
  if (!targetPath || !targetPath.startsWith('~/')) return targetPath
  return path.join(os.homedir(), targetPath.slice(2))
}

function resolveEnvUri() {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) return null
  const cfg = getConfig()
  const configured = cfg.get('envSwitcherFile', '.env.local')
  if (!configured || typeof configured !== 'string' || configured.trim() === '') return null
  const raw = expandHomePath(configured.trim())
  if (path.isAbsolute(raw)) {
    return vscode.Uri.file(raw)
  }
  return vscode.Uri.joinPath(workspaceFolders[0].uri, raw)
}

function parseEnvFile(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const blocks = []
  let current = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    if (trimmed.startsWith('#')) {
      const comment = trimmed.replace(/^#\s*/, '')
      if (comment && !comment.includes('=')) {
        current = { name: comment, entries: [] }
        blocks.push(current)
        continue
      }
    }

    if (!current) continue

    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1] : ''
    let rest = line.slice(indent.length)
    let commented = false
    if (rest.startsWith('#')) {
      commented = true
      rest = rest.replace(/^#\s*/, '')
    }
    if (!rest.includes('=')) continue
    current.entries.push({ lineIndex: index, indent, body: rest, commented })
  }

  const active = blocks.find((block) => block.entries.some((entry) => !entry.commented))
  return { eol, lines, blocks, activeName: active ? active.name : null }
}

async function readEnvFile(uri) {
  const data = await vscode.workspace.fs.readFile(uri)
  return decoder.decode(data)
}

async function writeEnvFile(uri, content) {
  const buffer = encoder.encode(content)
  await vscode.workspace.fs.writeFile(uri, buffer)
}

function formatStatusText(activeName, hasBlocks) {
  if (!hasBlocks) return '$(globe) env: n/a'
  return activeName ? `$(globe) ${activeName}` : '$(globe) env: none'
}

function toTooltip(activeName, uri, count) {
  const relative = vscode.workspace.workspaceFolders?.[0]
  const displayPath = relative ? path.relative(relative.uri.fsPath, uri.fsPath) || path.basename(uri.fsPath) : uri.fsPath
  const header = activeName ? `Active environment: ${activeName}` : 'No active environment detected'
  const summary = count === 1 ? '1 environment block found' : `${count} environment blocks found`
  return `${header}\n${summary}\n${displayPath}`
}

function registerEnvSwitcher(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 103)
  item.command = 'envSwitcher.select'
  item.accessibilityInformation = { label: 'WordPress environment switcher' }
  context.subscriptions.push(item)

  let watcher = null
  let currentUri = null
  let cachedParse = null

  async function updateStatus() {
    const uri = resolveEnvUri()
    currentUri = uri

    if (!uri) {
      cachedParse = null
      item.hide()
      return
    }

    try {
      const text = await readEnvFile(uri)
      cachedParse = parseEnvFile(text)
    } catch (error) {
      cachedParse = null
      item.hide()
      return
    }

    const { blocks, activeName } = cachedParse
    item.text = formatStatusText(activeName, blocks.length > 0)
    item.tooltip = toTooltip(activeName, uri, blocks.length)
    item.show()
  }

  function ensureWatcher() {
    if (watcher) {
      watcher.dispose()
      watcher = null
    }
    const cfg = getConfig()
    const configured = cfg.get('envSwitcherFile', '.env.local')
    if (!configured || typeof configured !== 'string' || configured.trim() === '') return
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) return
    const raw = configured.trim()
    if (path.isAbsolute(expandHomePath(raw))) return
    const pattern = new vscode.RelativePattern(workspaceFolders[0], raw)
    watcher = vscode.workspace.createFileSystemWatcher(pattern)
    watcher.onDidChange(() => updateStatus())
    watcher.onDidCreate(() => updateStatus())
    watcher.onDidDelete(() => updateStatus())
    context.subscriptions.push(watcher)
  }

  async function selectEnvironment() {
    if (!currentUri) {
      vscode.window.showWarningMessage('Env Switcher: no workspace env file configured.')
      return
    }
    if (!cachedParse) {
      await updateStatus()
    }
    if (!cachedParse) return

    const { blocks, activeName } = cachedParse
    if (!blocks.length) {
      vscode.window.showWarningMessage('Env Switcher: no environment blocks found.')
      return
    }

    const picks = blocks.map((block) => ({
      label: block.name,
      description: block.name === activeName ? 'currently active' : undefined,
      block,
    }))

    const selection = await vscode.window.showQuickPick(picks, {
      placeHolder: 'Select WordPress environment',
      matchOnDescription: true,
    })
    if (!selection) return
    if (selection.label === activeName) {
      vscode.window.setStatusBarMessage(`Environment '${selection.label}' is already active.`, 2000)
      return
    }

    const text = await readEnvFile(currentUri)
    const parsed = parseEnvFile(text)
    const target = parsed.blocks.find((block) => block.name === selection.label)
    if (!target) {
      vscode.window.showErrorMessage(`Env Switcher: block '${selection.label}' disappeared.`)
      await updateStatus()
      return
    }

    for (const block of parsed.blocks) {
      for (const entry of block.entries) {
        if (block === target) {
          parsed.lines[entry.lineIndex] = `${entry.indent}${entry.body}`
        } else {
          parsed.lines[entry.lineIndex] = `${entry.indent}# ${entry.body}`
        }
      }
    }

    const newContent = parsed.lines.join(parsed.eol)
    if (newContent === text) {
      await updateStatus()
      return
    }

    try {
      await writeEnvFile(currentUri, newContent)
      vscode.window.setStatusBarMessage(`Environment switched to ${selection.label}`, 2500)
    } catch (error) {
      vscode.window.showErrorMessage(`Env Switcher: failed to update file. ${error.message}`)
    }

    await updateStatus()
  }

  function updateStatusBarVisibility() {
    const cfg = getConfig()
    const showEnvSwitcher = cfg.get('showEnvSwitcher', true)
    if (showEnvSwitcher) {
      updateStatus()
    } else {
      item.hide()
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('envSwitcher.select', selectEnvironment),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('envSwitcher.envSwitcherFile')) {
        ensureWatcher()
        updateStatus()
      }
      if (event.affectsConfiguration('envSwitcher.showEnvSwitcher')) {
        updateStatusBarVisibility()
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      ensureWatcher()
      updateStatus()
    })
  )

  ensureWatcher()
  updateStatusBarVisibility()
}

module.exports = { registerEnvSwitcher }

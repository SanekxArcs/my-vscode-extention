const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { getConfig } = require('./config')

function ensureWorkspaceFolder() {
  return vscode.workspace.workspaceFolders?.[0]
}

function registerScriptCommands(context) {
  // Only dynamic status bar buttons are supported. Static buttons removed.

  let dynamicButtons = []
  let dynamicCommands = []

  const clearDynamicButtons = () => {
    for (const item of dynamicButtons) { try { item.dispose() } catch {} }
    for (const cmd of dynamicCommands) { try { cmd.dispose() } catch {} }
    dynamicButtons = []
    dynamicCommands = []
  }

  const buildDynamicButtons = () => {
    clearDynamicButtons()
    const useDynamic = getConfig().get('useDynamicScriptParsing', true)
    if (!useDynamic) return

    const workspaceFolder = ensureWorkspaceFolder()
    if (!workspaceFolder) return
    const packageJsonPath = path.join(workspaceFolder.uri.fsPath, 'package.json')
    if (!fs.existsSync(packageJsonPath)) return

    try {
      const cfg = getConfig()
      const reuseTerminals = cfg.get('reuseTerminalForScripts', true)
      const maxButtons = Math.max(0, parseInt(cfg.get('maxDynamicScriptButtons', 8))) || 8

      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      const scripts = pkg.scripts || {}
      const exclude = new Set(cfg.get('excludeScripts', []))
      const entries = Object.entries(scripts).filter(([name]) => !exclude.has(name))

      const priority = { dev: 3, start: 2, build: 1 }
      entries.sort((a, b) => (priority[b[0]] || 0) - (priority[a[0]] || 0) || a[0].localeCompare(b[0]))

      let basePriority = 110
      const visible = entries.slice(0, maxButtons)
      const overflow = entries.slice(maxButtons)

      const ensureTerminal = (name) => {
        const termName = `npm:${name}`
        if (reuseTerminals) {
          let t = vscode.window.terminals.find((t) => t.name === termName)
          if (!t) t = vscode.window.createTerminal({ name: termName, cwd: workspaceFolder.uri.fsPath })
          return t
        }
        return vscode.window.createTerminal({ name: termName, cwd: workspaceFolder.uri.fsPath })
      }

      for (const [name, cmd] of visible) {
        const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, basePriority--)
        const icon = name.includes('dev') ? '$(play)' : name.includes('build') ? '$(gear)' : name.includes('start') ? '$(rocket)' : '$(terminal)'
        item.text = `${icon} ${name}`
        item.tooltip = `Run script: ${name} -> ${cmd}`

        const commandId = `extension.runScript.${name}`
        const disposableCmd = vscode.commands.registerCommand(commandId, async () => {
          try {
            const terminal = ensureTerminal(name)
            terminal.show()
            // Try to stop any running process, then run again from workspace root
            terminal.sendText("\x03")
            setTimeout(() => {
              terminal.sendText(`cd "${workspaceFolder.uri.fsPath}" && npm run ${name}`)
            }, 250)
          } catch (error) {
            vscode.window.showErrorMessage(`Error running script ${name}: ${error.message}`)
          }
        })
        dynamicCommands.push(disposableCmd)
        context.subscriptions.push(disposableCmd)

        item.command = commandId
        item.show()
        dynamicButtons.push(item)
        context.subscriptions.push(item)
      }

      if (overflow.length > 0) {
        const overflowItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, basePriority--)
        overflowItem.text = `$(ellipsis) +${overflow.length}`
        overflowItem.tooltip = `More scripts`

        const overflowCommandId = `extension.runScript._overflow`
        const disposableOverflowCmd = vscode.commands.registerCommand(overflowCommandId, async () => {
          try {
            const picked = await vscode.window.showQuickPick(
              overflow.map(([name, cmd]) => ({ label: name, description: cmd })),
              { placeHolder: 'Select a script to run' }
            )
            if (!picked) return
            const terminal = ensureTerminal(picked.label)
            terminal.show()
            terminal.sendText("\x03")
            setTimeout(() => {
              terminal.sendText(`cd "${workspaceFolder.uri.fsPath}" && npm run ${picked.label}`)
            }, 250)
          } catch (error) {
            vscode.window.showErrorMessage(`Error running script: ${error.message}`)
          }
        })
        dynamicCommands.push(disposableOverflowCmd)
        context.subscriptions.push(disposableOverflowCmd)

        overflowItem.command = overflowCommandId
        overflowItem.show()
        dynamicButtons.push(overflowItem)
        context.subscriptions.push(overflowItem)
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to parse package.json scripts: ${e.message}`)
    }
  }

  const applyVisibility = () => {
    const useDynamic = getConfig().get('useDynamicScriptParsing', true)
    if (useDynamic) {
      buildDynamicButtons()
    } else {
      clearDynamicButtons()
    }
  }

  const runDev = vscode.commands.registerCommand('extension.runDevScript', async () => {
    try {
      const workspaceFolder = ensureWorkspaceFolder()
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found')
        return
      }
      const packageJsonPath = path.join(workspaceFolder.uri.fsPath, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        vscode.window.showErrorMessage('package.json not found')
        return
      }
      const packageContent = fs.readFileSync(packageJsonPath, 'utf8')
      const lines = packageContent.split('\n')

      let devScriptLineIndex = -1
      let originalDevScript = ''
      let insideScripts = false
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line.includes('"scripts"') && line.includes('{')) { insideScripts = true; continue }
        if (insideScripts && line.includes('}') && !line.includes('"')) { insideScripts = false; continue }
        if (insideScripts && line.includes('"dev"') && line.includes(':')) { devScriptLineIndex = i; originalDevScript = lines[i]; break }
      }
      if (devScriptLineIndex === -1) {
        vscode.window.showErrorMessage('Dev script not found in package.json')
        return
      }
      let needsRestore = false
      if (originalDevScript.includes('npm run node-version:check')) {
        const indentation = originalDevScript.match(/^(\s*)/)[1]
        lines[devScriptLineIndex] = `${indentation}"dev": "next dev",`
        fs.writeFileSync(packageJsonPath, lines.join('\n'))
        const document = await vscode.workspace.openTextDocument(packageJsonPath)
        await vscode.window.showTextDocument(document)
        await document.save()
        needsRestore = true
        vscode.window.showInformationMessage('Dev script temporarily modified to "next dev"')
      } else {
        vscode.window.showInformationMessage('Dev script running as-is (no node-version:check found)')
      }
      const terminal = vscode.window.createTerminal('Dev Script')
      terminal.show()
      terminal.sendText('npm run dev')
      if (needsRestore) {
        setTimeout(async () => {
          try {
            const currentContent = fs.readFileSync(packageJsonPath, 'utf8')
            const currentLines = currentContent.split('\n')
            if (devScriptLineIndex < currentLines.length) {
              currentLines[devScriptLineIndex] = originalDevScript
              fs.writeFileSync(packageJsonPath, currentLines.join('\n'))
              vscode.window.showInformationMessage('package.json dev script restored after 10 seconds!')
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Error restoring package.json: ${error.message}`)
          }
        }, 10000)
      }
      vscode.window.showInformationMessage('Dev script executed successfully!')
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error.message}`)
    }
  })
  context.subscriptions.push(runDev)

  const runStorybook = vscode.commands.registerCommand('extension.runStorybook', async () => {
    try {
      const workspaceFolder = ensureWorkspaceFolder()
      if (!workspaceFolder) { vscode.window.showErrorMessage('No workspace folder found'); return }
      const terminal = vscode.window.createTerminal('Storybook')
      terminal.show()
      terminal.sendText('npm run storybook')
      vscode.window.showInformationMessage('Storybook started!')
    } catch (error) { vscode.window.showErrorMessage(`Error: ${error.message}`) }
  })
  context.subscriptions.push(runStorybook)

  const runPrettier = vscode.commands.registerCommand('extension.runPrettierActiveFile', async () => {
    try {
      const activeEditor = vscode.window.activeTextEditor
      if (!activeEditor) { vscode.window.showWarningMessage('No active text editor found. Open a file to run Prettier.'); return }
      const filePath = activeEditor.document.fileName
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
      if (!workspaceFolder) { vscode.window.showErrorMessage('Cannot determine workspace folder for the active file.'); return }
      let prettierTerminal = vscode.window.terminals.find((t) => t.name === 'Prettier')
      if (!prettierTerminal) { prettierTerminal = vscode.window.createTerminal('Prettier') }
      prettierTerminal.show()
      prettierTerminal.sendText(`cd "${workspaceFolder.uri.fsPath}" && npx prettier --write "${filePath}"`)
      vscode.window.showInformationMessage(`Prettier command sent for: ${path.basename(filePath)}`)
    } catch (error) { vscode.window.showErrorMessage(`Error running Prettier: ${error.message}`) }
  })
  context.subscriptions.push(runPrettier)

  const runPrettierCheck = vscode.commands.registerCommand('extension.runPrettierCheckActiveFile', async () => {
    try {
      const activeEditor = vscode.window.activeTextEditor
      if (!activeEditor) { vscode.window.showWarningMessage('No active text editor found. Open a file to check with Prettier.'); return }
      const filePath = activeEditor.document.fileName
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
      if (!workspaceFolder) { vscode.window.showErrorMessage('Cannot determine workspace folder for the active file.'); return }
      let prettierTerminal = vscode.window.terminals.find((t) => t.name === 'Prettier')
      if (!prettierTerminal) { prettierTerminal = vscode.window.createTerminal('Prettier') }
      prettierTerminal.show()
      prettierTerminal.sendText(`cd "${workspaceFolder.uri.fsPath}" && npx prettier --check "${filePath}"`)
      vscode.window.showInformationMessage(`Prettier check command sent for: ${path.basename(filePath)}`)
    } catch (error) { vscode.window.showErrorMessage(`Error running Prettier check: ${error.message}`) }
  })
  context.subscriptions.push(runPrettierCheck)

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration('runScript.useDynamicScriptParsing') ||
      e.affectsConfiguration('runScript.excludeScripts') ||
      e.affectsConfiguration('runScript.maxDynamicScriptButtons') ||
      e.affectsConfiguration('runScript.reuseTerminalForScripts')
    ) {
      applyVisibility()
    }
  })
  context.subscriptions.push(onConfigChange)

  applyVisibility()

  return { applyVisibility, buildDynamicButtons, clearDynamicButtons }
}

module.exports = { registerScriptCommands }

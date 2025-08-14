const vscode = require('vscode')
const fs = require('fs')
const path = require('path')

function activate(context) {
  // Helper to read settings
  const getConfig = () => vscode.workspace.getConfiguration('runScript')

  // Helper to update settings
  const updateConfig = async (key, value) => {
    const config = vscode.workspace.getConfiguration('runScript')
    await config.update(key, value, vscode.ConfigurationTarget.Global)
  }

  // Keep references to dispose dynamic items
  let dynamicButtons = []
  let dynamicCommands = []

  // Function to clear dynamic buttons
  const clearDynamicButtons = () => {
    for (const item of dynamicButtons) {
      try {
        item.dispose()
      } catch {}
    }
    for (const cmd of dynamicCommands) {
      try {
        cmd.dispose()
      } catch {}
    }
    dynamicButtons = []
    dynamicCommands = []
  }

  // Function to build dynamic buttons from package.json scripts
  const buildDynamicButtons = () => {
    clearDynamicButtons()

    const useDynamic = getConfig().get('useDynamicScriptParsing', false)
    if (!useDynamic) return

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
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

      // Sort scripts by common priorities (dev, start, build first), then alphabetically
      const priority = { dev: 3, start: 2, build: 1 }
      entries.sort((a, b) => (priority[b[0]] || 0) - (priority[a[0]] || 0) || a[0].localeCompare(b[0]))

      let basePriority = 110 // place dynamic after our existing default ones

      // Build up to maxButtons as status bar items; others go to overflow
      const visible = entries.slice(0, maxButtons)
      const overflow = entries.slice(maxButtons)

      const ensureTerminal = (name) => {
        const termName = `npm:${name}`
        if (reuseTerminals) {
          let t = vscode.window.terminals.find((t) => t.name === termName)
          if (!t) t = vscode.window.createTerminal(termName)
          return t
        }
        return vscode.window.createTerminal(termName)
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
            terminal.sendText(`npm run ${name}`)
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

      // If there is overflow, add a single "+N" button that opens a quick pick list
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
            terminal.sendText(`npm run ${picked.label}`)
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

  // === Existing Dev Script Status Bar Item ===
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  )
  statusBarItem.text = '$(play) Run Dev'
  statusBarItem.tooltip = 'Run Dev S'
  statusBarItem.command = 'extension.runDevScript'
  context.subscriptions.push(statusBarItem)

  // === Existing Storybook Status Bar Item ===
  const storybookStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  )
  storybookStatusBarItem.text = '$(book) Run SB'
  storybookStatusBarItem.tooltip = 'Run SB'
  storybookStatusBarItem.command = 'extension.runStorybook'
  context.subscriptions.push(storybookStatusBarItem)

  // === Prettier (Active File) Status Bar Item ===
  const prettierStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98 // Priority
  )
  prettierStatusBarItem.text = '$(sparkle) Prettier (AF)'
  prettierStatusBarItem.tooltip = 'Run Prettier on current active file'
  prettierStatusBarItem.command = 'extension.runPrettierActiveFile'
  context.subscriptions.push(prettierStatusBarItem)

  // === Prettier (Check Active File) Status Bar Item ===
  const prettierCheckStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    97 // Priority
  )
  prettierCheckStatusBarItem.text = '$(check) Check '
  prettierCheckStatusBarItem.tooltip = 'Check Prettier formatting on current active file'
  prettierCheckStatusBarItem.command = 'extension.runPrettierCheckActiveFile'
  context.subscriptions.push(prettierCheckStatusBarItem)

  // Function to update visibility based on settings and dynamic mode
  const applyVisibility = () => {
    const useDynamic = getConfig().get('useDynamicScriptParsing', false)

    if (useDynamic) {
      statusBarItem.hide()
      storybookStatusBarItem.hide()
      prettierStatusBarItem.hide()
      prettierCheckStatusBarItem.hide()
      buildDynamicButtons()
    } else {
      clearDynamicButtons()
      getConfig().get('showDevButton', true) ? statusBarItem.show() : statusBarItem.hide()
      getConfig().get('showStorybookButton', true) ? storybookStatusBarItem.show() : storybookStatusBarItem.hide()
      getConfig().get('showPrettierButton', true) ? prettierStatusBarItem.show() : prettierStatusBarItem.hide()
      getConfig().get('showPrettierCheckButton', true) ? prettierCheckStatusBarItem.show() : prettierCheckStatusBarItem.hide()
    }
  }

  // Register commands (existing)
  let disposable = vscode.commands.registerCommand(
    'extension.runDevScript',
    async function () {
      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        if (!workspaceFolder) {
          vscode.window.showErrorMessage('No workspace folder found')
          return
        }

        const packageJsonPath = path.join(
          workspaceFolder.uri.fsPath,
          'package.json'
        )

        if (!fs.existsSync(packageJsonPath)) {
          vscode.window.showErrorMessage('package.json not found')
          return
        }

        const packageContent = fs.readFileSync(packageJsonPath, 'utf8')
        const lines = packageContent.split('\n')

        // Find the "dev" script line in the "scripts" section
        let devScriptLineIndex = -1
        let originalDevScript = ''
        let insideScripts = false
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim()
          
          // Check if we're entering the scripts section
          if (line.includes('"scripts"') && line.includes('{')) {
            insideScripts = true
            continue
          }
          
          // Check if we're exiting the scripts section
          if (insideScripts && line.includes('}') && !line.includes('"')) {
            insideScripts = false
            continue
          }
          
          // Look for the dev script line
          if (insideScripts && line.includes('"dev"') && line.includes(':')) {
            devScriptLineIndex = i
            originalDevScript = lines[i]
            break
          }
        }

        if (devScriptLineIndex === -1) {
          vscode.window.showErrorMessage('Dev script not found in package.json')
          return
        }

        let needsRestore = false
        
        // Check if the dev script contains "npm run node-version:check"
        if (originalDevScript.includes('npm run node-version:check')) {
          // Extract the indentation from the original line
          const indentation = originalDevScript.match(/^(\s*)/)[1]
          
          // Replace with just "next dev"
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

        // Only restore if we modified the script
        if (needsRestore) {
          setTimeout(async () => {
            try {
              const currentContent = fs.readFileSync(packageJsonPath, 'utf8')
              const currentLines = currentContent.split('\n')
              
              if (devScriptLineIndex < currentLines.length) {
                currentLines[devScriptLineIndex] = originalDevScript
                fs.writeFileSync(packageJsonPath, currentLines.join('\n'))
                vscode.window.showInformationMessage(
                  'package.json dev script restored after 10 seconds!'
                )
              }
            } catch (error) {
              vscode.window.showErrorMessage(
                `Error restoring package.json: ${error.message}`
              )
            }
          }, 10000)
        }

        vscode.window.showInformationMessage('Dev script executed successfully!')
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error.message}`)
      }
    }
  )

  context.subscriptions.push(disposable)

  let disposableStorybook = vscode.commands.registerCommand(
    'extension.runStorybook',
    async function () {
      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        if (!workspaceFolder) {
          vscode.window.showErrorMessage('No workspace folder found')
          return
        }
        const terminal = vscode.window.createTerminal('Storybook')
        terminal.show()
        terminal.sendText('npm run storybook')
        vscode.window.showInformationMessage('Storybook started!')
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error.message}`)
      }
    }
  )
  context.subscriptions.push(disposableStorybook)

  let disposablePrettier = vscode.commands.registerCommand(
    'extension.runPrettierActiveFile',
    async function () {
      try {
        const activeEditor = vscode.window.activeTextEditor
        if (!activeEditor) {
          vscode.window.showWarningMessage(
            'No active text editor found. Open a file to run Prettier.'
          )
          return
        }

        const filePath = activeEditor.document.fileName
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(
          activeEditor.document.uri
        )

        if (!workspaceFolder) {
          vscode.window.showErrorMessage(
            'Cannot determine workspace folder for the active file.'
          )
          return
        }

        let prettierTerminal = vscode.window.terminals.find(
          (t) => t.name === 'Prettier'
        )
        if (!prettierTerminal) {
          prettierTerminal = vscode.window.createTerminal('Prettier')
        }

        prettierTerminal.show()
        prettierTerminal.sendText(
          `cd "${workspaceFolder.uri.fsPath}" && npx prettier --write "${filePath}"`
        )

        vscode.window.showInformationMessage(
          `Prettier command sent for: ${path.basename(filePath)}`
        )
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error running Prettier: ${error.message}`
        )
      }
    }
  )
  context.subscriptions.push(disposablePrettier)

  let disposablePrettierCheck = vscode.commands.registerCommand(
    'extension.runPrettierCheckActiveFile',
    async function () {
      try {
        const activeEditor = vscode.window.activeTextEditor
        if (!activeEditor) {
          vscode.window.showWarningMessage(
            'No active text editor found. Open a file to check with Prettier.'
          )
          return
        }

        const filePath = activeEditor.document.fileName
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(
          activeEditor.document.uri
        )

        if (!workspaceFolder) {
          vscode.window.showErrorMessage(
            'Cannot determine workspace folder for the active file.'
          )
          return
        }

        let prettierTerminal = vscode.window.terminals.find(
          (t) => t.name === 'Prettier'
        )
        if (!prettierTerminal) {
          prettierTerminal = vscode.window.createTerminal('Prettier')
        }

        prettierTerminal.show()
        prettierTerminal.sendText(
          `cd "${workspaceFolder.uri.fsPath}" && npx prettier --check "${filePath}"`
        )

        vscode.window.showInformationMessage(
          `Prettier check command sent for: ${path.basename(filePath)}`
        )
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error running Prettier check: ${error.message}`
        )
      }
    }
  )
  context.subscriptions.push(disposablePrettierCheck)

  // Utilities for CSS value detection
  const detectValueAtPosition = (document, position) => {
    const line = document.lineAt(position.line).text
    // Find something like 12px, -0.5rem, 10.25vh, etc.
    const regex = /(-?\d*\.\d+|-?\d+)(px|rem|vw|vh)/g
    let match
    let best = null
    while ((match = regex.exec(line)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (position.character >= start && position.character <= end) {
        best = { text: match[0], start, end }
        break
      }
    }
    return best
  }

  // Core conversion helpers
  const toViewport = (pxValue, dimension, precision) => {
    if (!dimension) return null
    const val = (pxValue / dimension) * 100
    let result = val.toFixed(Math.max(0, Math.min(8, precision)))
    result = result.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
    return result
  }

  const parseScreen = (screenStr) => {
    const m = (screenStr || '').toString().match(/^(\d+)x(\d+)$/)
    if (!m) return null
    return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) }
  }

  const parseSelectedValue = (text) => {
    const m = text.trim().match(/^(-?\d*\.?\d+)\s*(px|rem|vw|vh)$/i)
    if (!m) return null
    return { value: parseFloat(m[1]), unit: m[2].toLowerCase() }
  }

  // Convert CSS unit to vw/vh from selection or cursor, supports multi-selections
  const convertCmd = vscode.commands.registerCommand('extension.convertToViewportUnit', async () => {
    const cfg = getConfig()
    const screens = cfg.get('viewportScreens', [])
    const precision = cfg.get('viewportPrecision', 4)
    const baseFontSize = cfg.get('baseFontSize', 16)
    let lastUnit = cfg.get('lastUsedViewportUnit', 'vw')
    let lastScreen = cfg.get('lastUsedScreen', '1440x900')

    if (!Array.isArray(screens) || screens.length === 0) {
      vscode.window.showErrorMessage('No screens configured. Add entries in settings: runScript.viewportScreens (e.g., 1440x1024).')
      return
    }

    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('Open a file to use the converter.')
      return
    }

    // Pick unit (default to last used)
    const vwOrVh = await vscode.window.showQuickPick(['vw', 'vh'], { placeHolder: 'Convert to vw or vh?', ignoreFocusOut: true })
    if (!vwOrVh) return

    // Pick screen (default to last used by placing it first if exists)
    const sortedScreens = [...screens]
    if (lastScreen && sortedScreens.includes(lastScreen)) {
      const idx = sortedScreens.indexOf(lastScreen)
      sortedScreens.splice(idx, 1)
      sortedScreens.unshift(lastScreen)
    }
    const picked = await vscode.window.showQuickPick(sortedScreens.map((s) => s.toString()), { placeHolder: 'Choose a target screen (WIDTHxHEIGHT)', ignoreFocusOut: true })
    if (!picked) return

    const parsed = parseScreen(picked)
    if (!parsed) {
      vscode.window.showErrorMessage(`Invalid screen format: ${picked}. Expected WIDTHxHEIGHT like 1440x1024.`)
      return
    }

    const denom = vwOrVh === 'vw' ? parsed.width : parsed.height
    if (!denom) {
      vscode.window.showErrorMessage('Selected screen dimension is zero or invalid.')
      return
    }

    const selections = editor.selections.length ? editor.selections : [editor.selection]

    await editor.edit((editBuilder) => {
      for (const sel of selections) {
        let text = editor.document.getText(sel)

        // If selection empty, try to detect under cursor
        if (!text) {
          const hit = detectValueAtPosition(editor.document, sel.start)
          if (hit) {
            text = hit.text
            const range = new vscode.Range(sel.start.line, hit.start, sel.start.line, hit.end)
            // Update sel to range
            const parsedVal = parseSelectedValue(text)
            if (!parsedVal || !['px', 'rem'].includes(parsedVal.unit)) continue
            const px = parsedVal.unit === 'rem' ? parsedVal.value * baseFontSize : parsedVal.value
            const res = toViewport(px, denom, precision)
            if (res == null) continue
            editBuilder.replace(range, `${res}${vwOrVh}`)
            continue
          } else {
            continue
          }
        }

        const parsedVal = parseSelectedValue(text)
        if (!parsedVal || !['px', 'rem'].includes(parsedVal.unit)) {
          continue
        }
        const px = parsedVal.unit === 'rem' ? parsedVal.value * baseFontSize : parsedVal.value
        const res = toViewport(px, denom, precision)
        if (res == null) continue
        editBuilder.replace(sel, `${res}${vwOrVh}`)
      }
    })

    // remember choices
    await updateConfig('lastUsedViewportUnit', vwOrVh)
    await updateConfig('lastUsedScreen', picked)

    vscode.window.showInformationMessage(`Converted to ${vwOrVh} for ${picked}`)
  })
  context.subscriptions.push(convertCmd)

  // Reverse: convert from vw/vh to px/rem
  const reverseCmd = vscode.commands.registerCommand('extension.reverseConvertFromViewportUnit', async () => {
    const cfg = getConfig()
    const screens = cfg.get('viewportScreens', [])
    const precision = cfg.get('viewportPrecision', 4)
    const baseFontSize = cfg.get('baseFontSize', 16)
    let lastUnit = cfg.get('lastUsedViewportUnit', 'vw')
    let lastScreen = cfg.get('lastUsedScreen', '1440x900')
    const defaultOutputUnit = cfg.get('defaultOutputUnit', 'px')

    if (!Array.isArray(screens) || screens.length === 0) {
      vscode.window.showErrorMessage('No screens configured. Add entries in settings: runScript.viewportScreens (e.g., 1440x1024).')
      return
    }

    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('Open a file to use the converter.')
      return
    }

    // Determine vw/vh; default to last used
    const vwOrVh = await vscode.window.showQuickPick(['vw', 'vh'], { placeHolder: 'Source unit: vw or vh?', ignoreFocusOut: true })
    if (!vwOrVh) return

    const sortedScreens = [...screens]
    if (lastScreen && sortedScreens.includes(lastScreen)) {
      const idx = sortedScreens.indexOf(lastScreen)
      sortedScreens.splice(idx, 1)
      sortedScreens.unshift(lastScreen)
    }
    const picked = await vscode.window.showQuickPick(sortedScreens.map((s) => s.toString()), { placeHolder: 'Choose a target screen (WIDTHxHEIGHT)', ignoreFocusOut: true })
    if (!picked) return

    const parsed = parseScreen(picked)
    if (!parsed) {
      vscode.window.showErrorMessage(`Invalid screen format: ${picked}. Expected WIDTHxHEIGHT like 1440x1024.`)
      return
    }

    const denom = vwOrVh === 'vw' ? parsed.width : parsed.height
    if (!denom) {
      vscode.window.showErrorMessage('Selected screen dimension is zero or invalid.')
      return
    }

    const outputUnit = await vscode.window.showQuickPick(['px', 'rem'], { placeHolder: `Output unit (default ${defaultOutputUnit})`, ignoreFocusOut: true })
    if (!outputUnit) return

    const selections = editor.selections.length ? editor.selections : [editor.selection]

    await editor.edit((editBuilder) => {
      for (const sel of selections) {
        let text = editor.document.getText(sel)

        if (!text) {
          const hit = detectValueAtPosition(editor.document, sel.start)
          if (hit) {
            text = hit.text
            const range = new vscode.Range(sel.start.line, hit.start, sel.start.line, hit.end)
            const parsedVal = parseSelectedValue(text)
            if (!parsedVal || !['vw', 'vh'].includes(parsedVal.unit)) continue
            const px = (parsedVal.value / 100) * denom
            let final
            if (outputUnit === 'rem') {
              const val = px / baseFontSize
              let result = val.toFixed(Math.max(0, Math.min(8, precision)))
              result = result.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
              final = `${result}rem`
            } else {
              let result = px.toFixed(Math.max(0, Math.min(8, precision)))
              result = result.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
              final = `${result}px`
            }
            editBuilder.replace(range, final)
            continue
          } else {
            continue
          }
        }

        const parsedVal = parseSelectedValue(text)
        if (!parsedVal || !['vw', 'vh'].includes(parsedVal.unit)) {
          continue
        }
        const px = (parsedVal.value / 100) * denom
        let final
        if (outputUnit === 'rem') {
          const val = px / baseFontSize
          let result = val.toFixed(Math.max(0, Math.min(8, precision)))
          result = result.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
          final = `${result}rem`
        } else {
          let result = px.toFixed(Math.max(0, Math.min(8, precision)))
          result = result.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
          final = `${result}px`
        }
        editBuilder.replace(sel, final)
      }
    })

    await updateConfig('lastUsedViewportUnit', vwOrVh)
    await updateConfig('lastUsedScreen', picked)

    vscode.window.showInformationMessage(`Converted ${vwOrVh} to ${outputUnit} for ${picked}`)
  })
  context.subscriptions.push(reverseCmd)

  // Lightweight Code Action Provider: shows actions when cursor is on a numeric unit
  const codeActionProvider = {
    provideCodeActions(document, range, context, token) {
      const pos = range?.start || vscode.window.activeTextEditor?.selection.start
      const hit = detectValueAtPosition(document, pos)
      if (!hit) return
      const parsed = parseSelectedValue(hit.text)
      if (!parsed) return

      const actions = []
      if (['px', 'rem'].includes(parsed.unit)) {
        const action = new vscode.CodeAction('Convert to vw/vh', vscode.CodeActionKind.RefactorRewrite)
        action.command = { command: 'extension.convertToViewportUnit', title: 'Convert to vw/vh' }
        actions.push(action)
      }
      if (['vw', 'vh'].includes(parsed.unit)) {
        const action = new vscode.CodeAction('Convert vw/vh to px/rem', vscode.CodeActionKind.RefactorRewrite)
        action.command = { command: 'extension.reverseConvertFromViewportUnit', title: 'Convert vw/vh to px/rem' }
        actions.push(action)
      }
      return actions
    }
  }

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      ['css', 'scss', 'sass', 'less', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
      codeActionProvider,
      { providedCodeActionKinds: [vscode.CodeActionKind.Refactor, vscode.CodeActionKind.RefactorRewrite] }
    )
  )

  // Listen for configuration changes to update visibility or rebuild dynamic buttons
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('runScript.useDynamicScriptParsing') ||
        e.affectsConfiguration('runScript.showDevButton') ||
        e.affectsConfiguration('runScript.showStorybookButton') ||
        e.affectsConfiguration('runScript.showPrettierButton') ||
        e.affectsConfiguration('runScript.showPrettierCheckButton') ||
        e.affectsConfiguration('runScript.excludeScripts') ||
        e.affectsConfiguration('runScript.maxDynamicScriptButtons') ||
        e.affectsConfiguration('runScript.reuseTerminalForScripts')
      ) {
        applyVisibility()
      }
    })
  )

  // Initial apply
  applyVisibility()
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
}

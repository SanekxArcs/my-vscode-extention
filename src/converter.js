const vscode = require('vscode')
const { getConfig, updateConfig } = require('./config')

const detectValueAtPosition = (document, position) => {
  const line = document.lineAt(position.line).text
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

function registerConverter(context) {
  const convertCmd = vscode.commands.registerCommand('extension.convertToViewportUnit', async () => {
    const cfg = getConfig()
    const screens = cfg.get('viewportScreens', [])
    const precision = cfg.get('viewportPrecision', 4)
    const baseFontSize = cfg.get('baseFontSize', 16)

    if (!Array.isArray(screens) || screens.length === 0) {
      vscode.window.showErrorMessage('No screens configured. Add entries in settings: runScript.viewportScreens (e.g., 1440x1024).')
      return
    }

    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('Open a file to use the converter.')
      return
    }

    const vwOrVh = await vscode.window.showQuickPick(['vw', 'vh'], { placeHolder: 'Convert to vw or vh?', ignoreFocusOut: true })
    if (!vwOrVh) return

    const lastScreen = getConfig().get('lastUsedScreen', '1440x900')
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

        if (!text) {
          const hit = detectValueAtPosition(editor.document, sel.start)
          if (hit) {
            text = hit.text
            const range = new vscode.Range(sel.start.line, hit.start, sel.start.line, hit.end)
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

    await updateConfig('lastUsedViewportUnit', vwOrVh)
    await updateConfig('lastUsedScreen', picked)

    vscode.window.showInformationMessage(`Converted to ${vwOrVh} for ${picked}`)
  })
  context.subscriptions.push(convertCmd)

  const reverseCmd = vscode.commands.registerCommand('extension.reverseConvertFromViewportUnit', async () => {
    const cfg = getConfig()
    const screens = cfg.get('viewportScreens', [])
    const precision = cfg.get('viewportPrecision', 4)
    const baseFontSize = cfg.get('baseFontSize', 16)
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

    const vwOrVh = await vscode.window.showQuickPick(['vw', 'vh'], { placeHolder: 'Source unit: vw or vh?', ignoreFocusOut: true })
    if (!vwOrVh) return

    const lastScreen = getConfig().get('lastUsedScreen', '1440x900')
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

  // Tailwind cycle: px -> rem -> tw number -> px
  const detectValueAtPositionLoose = (document, position) => {
    const line = document.lineAt(position.line).text
    // number with optional px|rem unit; ensure not followed by a letter or %
    const regex = /(-?\d*\.?\d+)(px|rem)?(?![a-zA-Z%])/g
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

  const parsePxRemOrTw = (text) => {
    const m = text.trim().match(/^(-?\d*\.?\d+)\s*(px|rem)?$/i)
    if (!m) return null
    return { value: parseFloat(m[1]), unit: (m[2] ? m[2].toLowerCase() : 'tw') }
  }

  const formatByUnit = (num, unit) => {
    const decimals = unit === 'px' ? 2 : unit === 'rem' ? 4 : /* tw */ 3
    let result = num.toFixed(decimals)
    result = result.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
    return result
  }

  const cycleTailwind = vscode.commands.registerCommand('extension.cycleTailwindUnit', async () => {
    const cfg = getConfig()
    const baseFontSize = cfg.get('baseFontSize', 16)

    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('Open a file to use the Tailwind unit cycler.')
      return
    }

    const selections = editor.selections.length ? editor.selections : [editor.selection]

    await editor.edit((editBuilder) => {
      for (const sel of selections) {
        let text = editor.document.getText(sel)

        if (!text) {
          const hit = detectValueAtPositionLoose(editor.document, sel.start)
          if (hit) {
            text = hit.text
            const range = new vscode.Range(sel.start.line, hit.start, sel.start.line, hit.end)
            const parsed = parsePxRemOrTw(text)
            if (!parsed) continue
            let out
            if (parsed.unit === 'px') {
              const rem = parsed.value / baseFontSize
              out = `${formatByUnit(rem, 'rem')}rem`
            } else if (parsed.unit === 'rem') {
              const tw = parsed.value * 4
              out = `${formatByUnit(tw, 'tw')}`
            } else {
              const px = parsed.value * 4
              out = `${formatByUnit(px, 'px')}px`
            }
            editBuilder.replace(range, out)
            continue
          } else {
            continue
          }
        }

        const parsed = parsePxRemOrTw(text)
        if (!parsed) continue
        let out
        if (parsed.unit === 'px') {
          const rem = parsed.value / baseFontSize
          out = `${formatByUnit(rem, 'rem')}rem`
        } else if (parsed.unit === 'rem') {
          const tw = parsed.value * 4
          out = `${formatByUnit(tw, 'tw')}`
        } else {
          const px = parsed.value * 4
          out = `${formatByUnit(px, 'px')}px`
        }
        editBuilder.replace(sel, out)
      }
    })
  })
  context.subscriptions.push(cycleTailwind)

  const codeActionProvider = {
    provideCodeActions(document, range) {
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
}

module.exports = { registerConverter }

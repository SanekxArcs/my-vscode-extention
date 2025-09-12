const vscode = require('vscode')
const { getConfig, updateConfig } = require('./config')

const detectValueAtPosition = (document, position) => {
  const line = document.lineAt(position.line).text
  const regex = /(-?\d*\.\d+|-?\d+)(px|rem|vw|vh|dvw|dvh|lvw|lvh|svw|svh|vmin|vmax)/g
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

const toFixedTrim = (num, prec) => {
  let result = num.toFixed(Math.max(0, Math.min(8, prec)))
  result = result.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
  return result
}

const parseScreen = (screenStr) => {
  const m = (screenStr || '').toString().match(/^(\d+)x(\d+)$/)
  if (!m) return null
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) }
}

const parseSelectedValue = (text) => {
  const m = text.trim().match(/^(-?\d*\.?\d+)\s*(px|rem|vw|vh|dvw|dvh|lvw|lvh|svw|svh|vmin|vmax)$/i)
  if (!m) return null
  return { value: parseFloat(m[1]), unit: m[2].toLowerCase() }
}

function registerConverter(context) {
  const viewportUnits = ['vw','vh','vmin','vmax','dvw','dvh','lvw','lvh','svw','svh']
  const parseViewportValue = (text) => {
    const m = text.trim().match(/^(-?\d*\.?\d+)\s*(vw|vh|vmin|vmax|dvw|dvh|lvw|lvh|svw|svh)$/i)
    if (!m) return null
    return { value: parseFloat(m[1]), unit: m[2].toLowerCase() }
  }

  const guessAxis = (lineText) => {
    try {
      const m = lineText.match(/^\s*([A-Za-z_-][A-Za-z0-9_-]*)\s*[:=]/)
      if (!m) return null
      const raw = m[1]
      const kebab = raw.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
      const widthProps = new Set(['width','left','right','margin-left','margin-right','padding-left','padding-right','margin-inline-start','margin-inline-end','padding-inline-start','padding-inline-end','gap','column-gap','letter-spacing','word-spacing','text-indent','translatex','transform'])
      const heightProps = new Set(['height','top','bottom','margin-top','margin-bottom','padding-top','padding-bottom','line-height','row-gap','translatey'])
      if (widthProps.has(kebab)) return 'vw'
      if (heightProps.has(kebab)) return 'vh'
      return null
    } catch { return null }
  }
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

    let vwOrVh = null
    const autoAxis = cfg.get('autoDetectViewportAxis', true)
    if (autoAxis) {
      const pos = editor.selections[0]?.start || editor.selection.start
      vwOrVh = guessAxis(editor.document.lineAt(pos.line).text)
    }
    if (!vwOrVh) {
      vwOrVh = await vscode.window.showQuickPick(['vw', 'vh'], { placeHolder: 'Convert to vw or vh?', ignoreFocusOut: true })
      if (!vwOrVh) return
    }

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

    const outputUnit = await vscode.window.showQuickPick(['px', 'rem'], { placeHolder: `Output unit (default ${defaultOutputUnit})`, ignoreFocusOut: true })
    if (!outputUnit) return

    const selections = editor.selections.length ? editor.selections : [editor.selection]

    const toFixedTrim = (num, prec) => {
      let result = num.toFixed(Math.max(0, Math.min(8, prec)))
      result = result.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
      return result
    }

    const unitRegex = /(-?\d*\.?\d+)\s*(vw|vh|vmin|vmax|dvw|dvh|lvw|lvh|svw|svh)\b/gi

    await editor.edit((editBuilder) => {
      for (const sel of selections) {
        const text = editor.document.getText(sel)
        const screen = parseScreen(picked)
        if (!screen) continue

        const convertMatch = (value, unit) => {
          let denom
          if (unit.endsWith('vw')) denom = screen.width
          else if (unit.endsWith('vh')) denom = screen.height
          else if (unit === 'vmin') denom = Math.min(screen.width, screen.height)
          else if (unit === 'vmax') denom = Math.max(screen.width, screen.height)
          else denom = screen.width
          const px = (value / 100) * denom
          return outputUnit === 'rem' ? `${toFixedTrim(px / baseFontSize, precision)}rem` : `${toFixedTrim(px, precision)}px`
        }

        if (!text) {
          const hit = detectValueAtPosition(editor.document, sel.start)
          if (!hit) continue
          const p = parseViewportValue(hit.text)
          if (!p) continue
          const range = new vscode.Range(sel.start.line, hit.start, sel.start.line, hit.end)
          editBuilder.replace(range, convertMatch(p.value, p.unit))
        } else {
          const replacements = []
          let m
          while ((m = unitRegex.exec(text)) !== null) {
            const value = parseFloat(m[1])
            const unit = m[2].toLowerCase()
            const startOffset = m.index
            const endOffset = m.index + m[0].length
            const start = editor.document.offsetAt(sel.start) + startOffset
            const end = editor.document.offsetAt(sel.start) + endOffset
            const startPos = editor.document.positionAt(start)
            const endPos = editor.document.positionAt(end)
            const out = convertMatch(value, unit)
            replacements.push({ range: new vscode.Range(startPos, endPos), out })
          }
          for (let i = replacements.length - 1; i >= 0; i--) {
            editBuilder.replace(replacements[i].range, replacements[i].out)
          }
        }
      }
    })

    await updateConfig('lastUsedScreen', picked)

    vscode.window.showInformationMessage(`Converted viewport units to ${outputUnit} for ${picked}`)
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
              const px = (parsed.value * baseFontSize) / 4
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
          const px = (parsed.value * baseFontSize) / 4
          out = `${formatByUnit(px, 'px')}px`
        }
        editBuilder.replace(sel, out)
      }
    })
  })
  context.subscriptions.push(cycleTailwind)

  // Convert cycle for explicit axis: Alt+V for vw, Alt+H for vh
  const runConvertCycleAxis = async (axis) => {
    const cfg = getConfig()
    const precision = cfg.get('viewportPrecision', 4)
    const baseFontSize = cfg.get('baseFontSize', 16)
    const editor = vscode.window.activeTextEditor
    if (!editor) { vscode.window.showWarningMessage('Open a file to convert.'); return }
    const screenStr = cfg.get('lastUsedScreen', '1440x900')
    const screen = parseScreen(screenStr)
    if (!screen) { vscode.window.showErrorMessage('Invalid lastUsedScreen setting.'); return }
    const denom = axis === 'vw' ? screen.width : screen.height
    const selections = editor.selections.length ? editor.selections : [editor.selection]
    const tokenRegex = axis === 'vw'
      ? /(-?\d*\.?\d+)\s*(px|rem|vw)\b/gi
      : /(-?\d*\.?\d+)\s*(px|rem|vh)\b/gi

    await editor.edit((editBuilder) => {
      for (const sel of selections) {
        const text = editor.document.getText(sel)
        if (!text) {
          // single token at cursor
          const hit = detectValueAtPosition(editor.document, sel.start)
          if (!hit) continue
          const m = hit.text.trim().match(/^(-?\d*\.?\d+)\s*(px|rem|vw|vh)$/i)
          if (!m) continue
          const value = parseFloat(m[1])
          const unit = m[2].toLowerCase()
          const range = new vscode.Range(sel.start.line, hit.start, sel.start.line, hit.end)
          let out = null
          if ((axis === 'vw' && unit === 'vw') || (axis === 'vh' && unit === 'vh')) {
            const px = (value / 100) * denom
            out = `${toFixedTrim(px, precision)}px`
          } else if (unit === 'px' || unit === 'rem') {
            const px = unit === 'rem' ? value * baseFontSize : value
            const vwvh = toViewport(px, denom, precision)
            if (vwvh != null) out = `${vwvh}${axis}`
          }
          if (out) editBuilder.replace(range, out)
        } else {
          // multiple matches in selection
          const replacements = []
          let m
          while ((m = tokenRegex.exec(text)) !== null) {
            const value = parseFloat(m[1])
            const unit = m[2].toLowerCase()
            let out = null
            if ((axis === 'vw' && unit === 'vw') || (axis === 'vh' && unit === 'vh')) {
              const px = (value / 100) * denom
              out = `${toFixedTrim(px, precision)}px`
            } else if (unit === 'px' || unit === 'rem') {
              const px = unit === 'rem' ? value * baseFontSize : value
              const vwvh = toViewport(px, denom, precision)
              if (vwvh != null) out = `${vwvh}${axis}`
            }
            if (!out) continue
            const startOffset = m.index
            const endOffset = m.index + m[0].length
            const start = editor.document.offsetAt(sel.start) + startOffset
            const end = editor.document.offsetAt(sel.start) + endOffset
            const startPos = editor.document.positionAt(start)
            const endPos = editor.document.positionAt(end)
            replacements.push({ range: new vscode.Range(startPos, endPos), out })
          }
          for (let i = replacements.length - 1; i >= 0; i--) {
            editBuilder.replace(replacements[i].range, replacements[i].out)
          }
        }
      }
    })
  }

  const cycleVW = vscode.commands.registerCommand('extension.convertCycleVW', async () => runConvertCycleAxis('vw'))
  const cycleVH = vscode.commands.registerCommand('extension.convertCycleVH', async () => runConvertCycleAxis('vh'))
  context.subscriptions.push(cycleVW, cycleVH)

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
      if (['vw','vh','vmin','vmax','dvw','dvh','lvw','lvh','svw','svh'].includes(parsed.unit)) {
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

  // Status Bar: show current design screen, base font size, and precision with quick toggle
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95)
  const updateStatus = () => {
    const scr = getConfig().get('lastUsedScreen', '1440x900')
    const base = getConfig().get('baseFontSize', 16)
    const prec = getConfig().get('viewportPrecision', 4)
    const screenText = (typeof scr === 'string' ? scr : String(scr)).replace('x', '×')
    statusItem.text = `$(device-mobile) ${screenText} | ${base}px | p${prec}`
    statusItem.tooltip = 'Click to change viewport screen, base font size, or precision'
  }

  const cycleScreenCmd = vscode.commands.registerCommand('extension.cycleViewportScreen', async () => {
    const cfg = getConfig()
    const screens = cfg.get('viewportScreens', [])
    if (!Array.isArray(screens) || screens.length === 0) {
      vscode.window.showErrorMessage('No screens configured. Add entries in settings: runScript.viewportScreens (e.g., 1440x1024).')
      return
    }
    const current = cfg.get('lastUsedScreen', screens[0])
    const idx = screens.map(String).indexOf(String(current))
    const next = screens[(idx >= 0 ? (idx + 1) % screens.length : 0)]
    await updateConfig('lastUsedScreen', String(next))
    updateStatus()
  })
  context.subscriptions.push(cycleScreenCmd)

  const settingsCmd = vscode.commands.registerCommand('extension.viewportSettingsQuick', async () => {
    const pick = await vscode.window.showQuickPick([
      { label: 'Change screen', action: 'screen' },
      { label: 'Change base font size', action: 'base' },
      { label: 'Change precision', action: 'precision' }
    ], { placeHolder: 'Viewport settings' })
    if (!pick) return
    const cfg = getConfig()
    if (pick.action === 'screen') {
      const screens = cfg.get('viewportScreens', [])
      const chosen = await vscode.window.showQuickPick((screens || []).map(String), { placeHolder: 'Select design screen WIDTHxHEIGHT' })
      if (chosen) await updateConfig('lastUsedScreen', chosen)
    } else if (pick.action === 'base') {
      const current = cfg.get('baseFontSize', 16)
      const input = await vscode.window.showInputBox({ prompt: 'Base font size (px)', value: String(current), validateInput: (v) => (/^\d+(\.\d+)?$/.test(v) && parseFloat(v) > 0) ? null : 'Enter a positive number' })
      if (input) await updateConfig('baseFontSize', parseFloat(input))
    } else if (pick.action === 'precision') {
      const current = cfg.get('viewportPrecision', 4)
      const options = Array.from({ length: 9 }, (_, i) => String(i))
      const chosen = await vscode.window.showQuickPick(options, { placeHolder: `Select precision (current ${current})` })
      if (chosen != null) await updateConfig('viewportPrecision', parseInt(chosen, 10))
    }
    updateStatus()
  })
  context.subscriptions.push(settingsCmd)
  statusItem.command = 'extension.viewportSettingsQuick'
  updateStatus()
  statusItem.show()

  // Quick convert command: convert values at cursor/selection to current vw/vh
  const quickConvertCmd = vscode.commands.registerCommand('extension.convertHereQuick', async () => {
    const cfg = getConfig()
    const screens = cfg.get('viewportScreens', [])
    const precision = cfg.get('viewportPrecision', 4)
    const baseFontSize = cfg.get('baseFontSize', 16)
    const editor = vscode.window.activeTextEditor
    if (!editor) { vscode.window.showWarningMessage('Open a file to convert.'); return }

    const lastScreen = cfg.get('lastUsedScreen', '1440x900')
    const parsed = parseScreen(lastScreen)
    if (!parsed) { vscode.window.showErrorMessage('Invalid lastUsedScreen setting.'); return }

    let axis = 'vw'
    const autoAxis = cfg.get('autoDetectViewportAxis', true)
    if (autoAxis) {
      const pos = editor.selections[0]?.start || editor.selection.start
      axis = guessAxis(editor.document.lineAt(pos.line).text) || 'vw'
    }

    const denom = axis === 'vw' ? parsed.width : parsed.height
    const selections = editor.selections.length ? editor.selections : [editor.selection]

    const pxRemRegex = /(-?\d*\.?\d+)\s*(px|rem)\b/gi

    await editor.edit((editBuilder) => {
      for (const sel of selections) {
        const text = editor.document.getText(sel)
        if (!text) {
          const hit = detectValueAtPosition(editor.document, sel.start)
          if (!hit) continue
          const parsedVal = parseSelectedValue(hit.text)
          if (!parsedVal || !['px', 'rem'].includes(parsedVal.unit)) continue
          const range = new vscode.Range(sel.start.line, hit.start, sel.start.line, hit.end)
          const px = parsedVal.unit === 'rem' ? parsedVal.value * baseFontSize : parsedVal.value
          const res = toViewport(px, denom, precision)
          if (res == null) continue
          editBuilder.replace(range, `${res}${axis}`)
        } else {
          const replacements = []
          let m
          while ((m = pxRemRegex.exec(text)) !== null) {
            const value = parseFloat(m[1])
            const unit = m[2].toLowerCase()
            const px = unit === 'rem' ? value * baseFontSize : value
            const out = `${toViewport(px, denom, precision)}${axis}`
            const startOffset = m.index
            const endOffset = m.index + m[0].length
            const start = editor.document.offsetAt(sel.start) + startOffset
            const end = editor.document.offsetAt(sel.start) + endOffset
            const startPos = editor.document.positionAt(start)
            const endPos = editor.document.positionAt(end)
            replacements.push({ range: new vscode.Range(startPos, endPos), out })
          }
          for (let i = replacements.length - 1; i >= 0; i--) {
            editBuilder.replace(replacements[i].range, replacements[i].out)
          }
        }
      }
    })
  })
  context.subscriptions.push(quickConvertCmd)

  // Status bar Convert button
  const convertItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94)
  convertItem.text = '$(wand) Convert Here'
  convertItem.tooltip = 'Convert values at cursor/selection to current viewport axis'
  convertItem.command = 'extension.convertHereQuick'
  convertItem.show()
  context.subscriptions.push(convertItem)

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration('runScript.lastUsedScreen') ||
      e.affectsConfiguration('runScript.baseFontSize') ||
      e.affectsConfiguration('runScript.viewportPrecision')
    ) {
      updateStatus()
    }
  }))
}

module.exports = { registerConverter }

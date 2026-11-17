const os = require('os')
const path = require('path')
const vscode = require('vscode')
const { isValidEntry, describeEntry, loadEntries, saveEntries, sanitizeEntry } = require('./entries')

const FILE_NAME = 'terminal-mate-commands.json'
const ADD = 'Add to my commands (skip duplicates)'
const REPLACE = 'Replace all my commands'

function registerImportExport(context) {
  const exportCommand = vscode.commands.registerCommand('terminal-mate.exportCommands', async () => {
    try {
      const entries = loadEntries().map(sanitizeEntry).filter(Boolean)
      if (!entries.length) {
        vscode.window.showInformationMessage('TerminalMate: There are no saved commands to export.')
        return
      }
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri
      const uri = await vscode.window.showSaveDialog({
        title: 'Export TerminalMate commands',
        defaultUri: folder ? vscode.Uri.joinPath(folder, FILE_NAME) : vscode.Uri.file(path.join(os.homedir(), FILE_NAME)),
        filters: { JSON: ['json'] },
      })
      if (!uri) return
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(entries, null, 2) + '\n', 'utf8'))
      vscode.window.showInformationMessage(`TerminalMate: Exported ${entries.length} command(s) to ${uri.fsPath}`)
    } catch (error) {
      vscode.window.showErrorMessage(`TerminalMate: Export failed: ${error.message}`)
    }
  })

  const importCommand = vscode.commands.registerCommand('terminal-mate.importCommands', async () => {
    try {
      const picked = await vscode.window.showOpenDialog({
        title: 'Import TerminalMate commands',
        canSelectMany: false,
        filters: { JSON: ['json'] },
      })
      if (!picked?.length) return

      let parsed
      try {
        parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString('utf8'))
      } catch {
        vscode.window.showErrorMessage('TerminalMate: That file is not valid JSON.')
        return
      }
      // Accepts an exported list, or a settings.json-style object
      const list = Array.isArray(parsed) ? parsed : parsed?.['terminal-mate.customTerminals'] || parsed?.commands
      const incoming = Array.isArray(list) ? list.map(sanitizeEntry).filter(Boolean) : []
      if (!incoming.length) {
        vscode.window.showWarningMessage('TerminalMate: No commands found in that file.')
        return
      }

      const current = loadEntries()
      let mode = ADD
      if (current.some(isValidEntry)) {
        mode = await vscode.window.showQuickPick([ADD, REPLACE], {
          placeHolder: `Import ${incoming.length} command(s)`,
        })
        if (!mode) return
      }

      if (mode === REPLACE) {
        const confirm = await vscode.window.showWarningMessage(
          `TerminalMate: Replace your ${current.length} saved command(s) with the ${incoming.length} from this file?`,
          { modal: true },
          'Replace'
        )
        if (confirm !== 'Replace') return
        await saveEntries(incoming)
        vscode.window.showInformationMessage(`TerminalMate: Imported ${incoming.length} command(s).`)
        return
      }

      const keyOf = (entry) => `${entry.title.trim()}\u0000${describeEntry(entry)}`
      const known = new Set(current.filter(isValidEntry).map(keyOf))
      const fresh = incoming.filter((entry) => !known.has(keyOf(entry)))
      if (fresh.length) await saveEntries([...current, ...fresh])
      const skipped = incoming.length - fresh.length
      vscode.window.showInformationMessage(
        `TerminalMate: Imported ${fresh.length} command(s)` + (skipped ? `, skipped ${skipped} already in your list.` : '.')
      )
    } catch (error) {
      vscode.window.showErrorMessage(`TerminalMate: Import failed: ${error.message}`)
    }
  })

  context.subscriptions.push(exportCommand, importCommand)
}

module.exports = { registerImportExport }

const { registerTerminalMate } = require('./src/gitTerminal')
const { registerScheduler } = require('./src/scheduler')
const { registerImportExport } = require('./src/importExport')

function activate(context) {
  const terminalMate = registerTerminalMate(context)
  registerScheduler(context, terminalMate)
  registerImportExport(context)
}

function deactivate() {}

module.exports = { activate, deactivate }

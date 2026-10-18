const { registerTerminalMate } = require('./src/gitTerminal')
const { registerScheduler } = require('./src/scheduler')

function activate(context) {
  const terminalMate = registerTerminalMate(context)
  registerScheduler(context, terminalMate)
}

function deactivate() {}

module.exports = { activate, deactivate }

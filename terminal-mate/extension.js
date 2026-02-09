const { registerTerminalMate } = require('./src/gitTerminal')

function activate(context) {
  registerTerminalMate(context)
}

function deactivate() {}

module.exports = { activate, deactivate }

const { registerScriptCommands } = require('./src/scripts')

function activate(context) {
  registerScriptCommands(context)
}

function deactivate() {}

module.exports = { activate, deactivate }

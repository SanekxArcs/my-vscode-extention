const { registerScriptCommands } = require('./src/scripts')
const { registerConverter } = require('./src/converter')
const { registerGitShortcuts } = require('./src/gitShortcuts')

function activate(context) {
  registerScriptCommands(context)
  registerConverter(context)
  registerGitShortcuts(context)
}

function deactivate() {}

module.exports = { activate, deactivate }

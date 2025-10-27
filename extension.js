const { registerScriptCommands } = require('./src/scripts')
const { registerConverter } = require('./src/converter')
const { registerGitShortcuts } = require('./src/gitShortcuts')
const { registerEnvSwitcher } = require("./src/envSwitcher");

function activate(context) {
  registerScriptCommands(context)
  registerConverter(context)
  registerGitShortcuts(context)
  registerEnvSwitcher(context);
}

function deactivate() {}

module.exports = { activate, deactivate }

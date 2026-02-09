const { registerEnvSwitcher } = require('./src/envSwitcher')

function activate(context) {
  registerEnvSwitcher(context)
}

function deactivate() {}

module.exports = { activate, deactivate }

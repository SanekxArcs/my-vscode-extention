const { registerConverter } = require('./src/converter')

function activate(context) {
  registerConverter(context)
}

function deactivate() {}

module.exports = { activate, deactivate }

const { registerConverter } = require('./src/converter')

function activate(context) {
  console.log('VC-Mate activated')
  registerConverter(context)
}

function deactivate() {}

module.exports = { activate, deactivate }

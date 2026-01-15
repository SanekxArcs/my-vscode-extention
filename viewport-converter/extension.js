const { registerConverter } = require('./src/converter')

function activate(context) {
  console.log('Viewport Converter activated')
  registerConverter(context)
}

function deactivate() {}

module.exports = { activate, deactivate }

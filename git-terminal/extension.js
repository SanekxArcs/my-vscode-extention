const { registerGitTerminal } = require('./src/gitTerminal')

function activate(context) {
  registerGitTerminal(context)
}

function deactivate() {}

module.exports = { activate, deactivate }

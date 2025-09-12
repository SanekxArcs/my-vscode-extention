const vscode = require('vscode')

const getConfig = () => vscode.workspace.getConfiguration('runScript')

const updateConfig = async (key, value) => {
  const config = vscode.workspace.getConfiguration('runScript')
  await config.update(key, value, vscode.ConfigurationTarget.Global)
}

module.exports = { getConfig, updateConfig }

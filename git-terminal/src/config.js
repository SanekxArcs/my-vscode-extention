const vscode = require('vscode')

const CONFIG_SECTION = 'gitTerminal'

function getConfig() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION)
}

async function updateConfig(key, value) {
  const config = getConfig()
  await config.update(key, value, vscode.ConfigurationTarget.Global)
}

module.exports = { getConfig, updateConfig, CONFIG_SECTION }

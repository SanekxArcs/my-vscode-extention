const vscode = require('vscode')

const CONFIG_SECTION = 'run-mate-script-runner'

function getConfig() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION)
}

/**
 * Changes a setting where the user already keeps it: in the workspace when a
 * workspace value exists, otherwise in user settings.
 */
async function updateSetting(key, value) {
  const config = getConfig()
  const info = config.inspect(key)
  const target =
    info && info.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global
  await config.update(key, value, target)
}

module.exports = { getConfig, updateSetting, CONFIG_SECTION }

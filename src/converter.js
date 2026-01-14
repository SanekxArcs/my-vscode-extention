const vscode = require('vscode')
const {
  registerConverter: originalRegisterConverter,
} = require("../viewport-converter/src/converter");
const { getConfig, updateConfig } = require('./config')

function registerConverter(context) {
  originalRegisterConverter(context, {
    commandPrefix: "extension",
    configSection: "runScript",
    getConfig,
    updateConfig,
  });
}

module.exports = { registerConverter }

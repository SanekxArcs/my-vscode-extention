const vscode = require("vscode");
const { registerScriptCommands } = require("./src/scripts");

function activate(context) {
  try {
    console.log("RunMate activating...");
    registerScriptCommands(context);
    console.log("RunMate activated successfully.");
  } catch (error) {
    console.error("RunMate activation failed:", error);
    vscode.window.showErrorMessage(`RunMate failed to start: ${error.message}`);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };

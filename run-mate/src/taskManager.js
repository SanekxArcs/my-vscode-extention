const vscode = require('vscode')
const { getConfig } = require('./config')

function getRunCommand(pm, name, hasNvmrc = false) {
  let command = "";
  if (hasNvmrc) {
    command = ". ~/.nvm/nvm.sh && nvm use && ";
  }

  switch (pm) {
    case "pnpm":
      return command + `pnpm run ${name}`;
    case "yarn":
      return command + `yarn ${name}`;
    case "bun":
      return command + `bun run ${name}`;
    default:
      return command + `npm run ${name}`;
  }
}

function createTask(folder, pm, name, hasNvmrc = false) {
  const shellCmd = getRunCommand(pm, name, hasNvmrc);
  const execution = new vscode.ShellExecution(shellCmd, {
    cwd: folder.uri.fsPath,
    env: process.env,
  });

  const task = new vscode.Task(
    { type: "run-mate-script-runner", script: name, pm, folderPath: folder.uri.fsPath },
    folder,
    `run ${name}`,
    "RunMate",
    execution,
    []
  );

  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    clear: false,
    panel: vscode.TaskPanelKind.Dedicated,
  };

  return task;
}

async function terminateExistingIfNeeded(folder, name, pm) {
  const cfg = getConfig()
  const askBeforeKill = cfg.get('askBeforeKill', true)

  for (const execution of vscode.tasks.taskExecutions) {
    try {
      const def = execution.task.definition
      if (
        def?.type === "run-mate-script-runner" &&
        def.script === name &&
        def.pm === pm &&
        def.folderPath === folder.uri.fsPath
      ) {
        if (askBeforeKill) {
          const pick = await vscode.window.showWarningMessage(
            `Stop running script ${name} in ${folder.name}?`,
            { modal: true },
            "Stop"
          );
          if (pick !== "Stop") return false;
        }
        await execution.terminate();
      }
    } catch {
    }
  }

  return true
}

module.exports = {
  createTask,
  terminateExistingIfNeeded
}

const vscode = require('vscode')
const { getConfig } = require('./config')

function getRunCommand(pm, name, hasNvmrc = false, installFirst = false) {
  let command = "";
  if (hasNvmrc) {
    command = ". ~/.nvm/nvm.sh && nvm use && ";
  }

  const getPMCmd = (pm) => {
    switch (pm) {
      case "pnpm": return "pnpm"
      case "yarn": return "yarn"
      case "bun": return "bun"
      default: return "npm"
    }
  }

  const pmCmd = getPMCmd(pm)

  if (installFirst) {
    const installCmd = pm === "yarn" ? "yarn install" : `${pmCmd} install`
    command += `${installCmd} && `
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

function createTask(folder, pm, name, hasNvmrc = false, installFirst = false) {
  const shellCmd = getRunCommand(pm, name, hasNvmrc, installFirst);
  const execution = new vscode.ShellExecution(shellCmd, {
    cwd: folder.uri.fsPath,
    env: process.env,
  });

  const task = new vscode.Task(
    { type: "run-mate-script-runner", script: name, pm, folderPath: folder.uri.fsPath, installFirst },
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

const vscode = require('vscode')
const { getConfig } = require('./config')
const { readNvmrcVersion } = require('./packageUtils')

async function getRunCommand(pm, name, folderUri, hasNvmrc = false, installFirst = false) {
  let command = "";
  if (hasNvmrc) {
    if (process.platform === "win32") {
      // nvm-windows (coreybutler) is a plain executable on PATH — no nvm.sh to
      // source — but unlike POSIX nvm it doesn't read .nvmrc automatically,
      // so the version must be passed explicitly (falls back to `nvm use`
      // for aliases like "lts/*" that nvm-windows can't resolve anyway).
      const version = await readNvmrcVersion(folderUri);
      command = version ? `nvm use ${version} && ` : "nvm use && ";
    } else {
      command = ". ~/.nvm/nvm.sh && nvm use && ";
    }
  }

  const getPMCmd = (pm) => {
    switch (pm) {
      case "pnpm": return "pnpm"
      case "yarn": return "yarn"
      case "yarn-berry": return "corepack yarn"
      case "bun": return "bun"
      default: return "npm"
    }
  }

  const pmCmd = getPMCmd(pm)

  if (installFirst) {
    const installCmd = (pm === "yarn" || pm === "yarn-berry") ? `${pmCmd} install` : `${pmCmd} install`
    command += `${installCmd} && `
  }

  switch (pm) {
    case "pnpm":
      return command + `pnpm run ${name}`;
    case "yarn":
      return command + `yarn ${name}`;
    case "yarn-berry":
      return command + `corepack yarn run ${name}`;
    case "bun":
      return command + `bun run ${name}`;
    default:
      return command + `npm run ${name}`;
  }
}

async function createTask(folder, pm, name, hasNvmrc = false, installFirst = false) {
  const shellCmd = await getRunCommand(pm, name, folder.uri, hasNvmrc, installFirst);

  const executionOptions = {
    cwd: folder.uri.fsPath,
    env: process.env,
  };

  // The nvm sourcing line is bash syntax (". ~/.nvm/nvm.sh && ..."), which
  // breaks if the user's default integrated shell isn't bash/zsh (e.g. fish
  // can't parse nvm.sh's case patterns). Force bash for this command
  // regardless of the configured default shell.
  if (hasNvmrc && process.platform !== "win32") {
    executionOptions.executable = "bash";
    executionOptions.shellArgs = ["-c"];
  }

  const execution = new vscode.ShellExecution(shellCmd, executionOptions);

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

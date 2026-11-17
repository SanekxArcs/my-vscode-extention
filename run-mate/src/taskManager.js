const vscode = require('vscode')

const TASK_TYPE = 'run-mate-script-runner'

/** Identity of a running script: the project folder plus the script name. */
function runKey(folderPath, script) {
  return `${folderPath}::${script}`
}

function isRunMateTask(task) {
  const def = task?.definition
  return def?.type === TASK_TYPE && typeof def.folderPath === 'string'
}

/**
 * Creates the task for one script. `plan` comes from planRun(): the shell is
 * always set explicitly so the command line matches the shell that runs it.
 */
function createTask(project, script, label, plan, reuseTerminal) {
  const execution = new vscode.ShellExecution(plan.commandLine, {
    cwd: project.dir,
    executable: plan.shell.executable,
    shellArgs: plan.shell.args,
    // Variables of the chosen env file, added to the terminal's environment.
    ...(plan.env ? { env: plan.env } : {}),
  })

  const task = new vscode.Task(
    { type: TASK_TYPE, script, folderPath: project.dir },
    project.folder,
    project.relPath ? `${label} (${project.name})` : label,
    'RunMate',
    execution,
    []
  )

  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    clear: false,
    panel: reuseTerminal ? vscode.TaskPanelKind.Dedicated : vscode.TaskPanelKind.New,
  }

  return task
}

/** Running RunMate executions of one script in one project folder. */
function findExecutions(folderPath, script) {
  return vscode.tasks.taskExecutions.filter(
    (execution) =>
      isRunMateTask(execution.task) &&
      execution.task.definition.folderPath === folderPath &&
      execution.task.definition.script === script
  )
}

module.exports = { TASK_TYPE, runKey, isRunMateTask, createTask, findExecutions }

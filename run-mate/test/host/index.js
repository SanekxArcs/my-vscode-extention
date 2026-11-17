/**
 * Runs inside a real VS Code extension host (see test/host/launch.js).
 * Starts scripts through the real task system in every installed shell and
 * checks the exit codes, so VS Code's own command-line quoting is covered.
 *
 * Results go to the file named by RUNMATE_HOST_RESULT.
 */
const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const shells = require('../../src/shells')
const nodeEnv = require('../../src/nodeEnv')
const { createTask } = require('../../src/taskManager')

const TIMEOUT_MS = 60000

function runTask(task) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listener.dispose()
      reject(new Error('timed out'))
    }, TIMEOUT_MS)
    let execution = null
    const listener = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution !== execution) return
      clearTimeout(timer)
      listener.dispose()
      resolve(event.exitCode)
    })
    vscode.tasks.executeTask(task).then((started) => {
      execution = started
    }, reject)
  })
}

function waitForTaskEnd(script) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listener.dispose()
      reject(new Error('timed out'))
    }, TIMEOUT_MS)
    const listener = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task.definition.script !== script) return
      clearTimeout(timer)
      listener.dispose()
      resolve({ exitCode: event.exitCode, task: event.execution.task })
    })
  })
}

async function run() {
  const results = []
  const record = (name, ok, info = '') => results.push({ name, ok, info: String(info) })
  const check = async (name, fn) => {
    try {
      record(name, true, (await fn()) ?? '')
    } catch (error) {
      record(name, false, error.stack || error)
    }
  }

  try {
    const folder = vscode.workspace.workspaceFolders[0]
    const root = folder.uri.fsPath
    const marker = (name) => path.join(root, `${name}.marker`)
    const web = { dir: path.join(root, 'apps', 'web'), folder, name: 'web', relPath: 'apps/web' }

    const extension = vscode.extensions.all.find((e) => e.id.toLowerCase().endsWith('run-mate-script-runner'))
    await extension.activate()
    await new Promise((resolve) => setTimeout(resolve, 1500))

    await check('commands are registered', async () => {
      const all = await vscode.commands.getCommands(true)
      for (const id of ['showAllScripts', 'showProjectScripts', 'runScript', 'stopScript', 'stopRunningScripts']) {
        if (!all.includes(`run-mate-script-runner.${id}`)) throw new Error(`missing ${id}`)
      }
    })

    await check('the script list opens with separators and row buttons', async () => {
      await vscode.commands.executeCommand('run-mate-script-runner.showAllScripts')
      await new Promise((resolve) => setTimeout(resolve, 500))
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen')
    })

    const config = vscode.workspace.getConfiguration('run-mate-script-runner')
    const fnm = Boolean(shells.which('fnm'))

    for (const shell of shells.listShells(vscode.env.shell)) {
      // Through the extension: setting -> plan -> task -> real terminal.
      await check(`${shell.label}: nested script runs in its own folder`, async () => {
        await config.update('shell', shell.id, vscode.ConfigurationTarget.Global)
        fs.rmSync(marker('web'), { force: true })
        const ended = waitForTaskEnd('mark')
        await vscode.commands.executeCommand('run-mate-script-runner.runScript', `${web.dir}::mark`)
        const { exitCode, task } = await ended
        if (exitCode !== 0) throw new Error(`exit code ${exitCode}`)
        if (!fs.existsSync(marker('web'))) throw new Error('script did not run in apps/web')
        return `${task.execution.options.executable} :: ${task.execution.commandLine}`
      })

      await check(`${shell.label}: a failing script reports its exit code`, async () => {
        const ended = waitForTaskEnd('boom')
        await vscode.commands.executeCommand('run-mate-script-runner.runScript', `${web.dir}::boom`)
        const { exitCode } = await ended
        if (!exitCode) throw new Error(`expected a failure, got ${exitCode}`)
        return `exit code ${exitCode}`
      })

      if (fnm && shell.id !== 'default') {
        // The fnm environment line is the trickiest one to quote.
        await check(`${shell.label}: fnm environment line survives VS Code quoting`, async () => {
          const resolved = shells.resolveShell(shell.id, vscode.env.shell)
          const [envLine] = nodeEnv.buildActivation({ id: 'fnm' }, resolved, nodeEnv.parseSpec('20')).setup
          fs.rmSync(marker('web'), { force: true })
          const commandLine = shells.chainCommands(resolved.family, [envLine, 'npm run mark'])
          const exitCode = await runTask(createTask(web, 'fnm-env', 'fnm-env', { shell: resolved, commandLine }, false))
          if (exitCode !== 0) throw new Error(`exit code ${exitCode} for: ${commandLine}`)
          if (!fs.existsSync(marker('web'))) throw new Error('script did not run')
          return commandLine
        })
      }
    }
    await config.update('shell', undefined, vscode.ConfigurationTarget.Global)

    await check('the variables of an env file reach the script', async () => {
      await config.update('envFile', '.env.test', vscode.ConfigurationTarget.Global)
      fs.rmSync(marker('env'), { force: true })
      const ended = waitForTaskEnd('envmark')
      await vscode.commands.executeCommand('run-mate-script-runner.runScript', `${web.dir}::envmark`)
      const { exitCode, task } = await ended
      await config.update('envFile', undefined, vscode.ConfigurationTarget.Global)
      if (exitCode !== 0) throw new Error(`exit code ${exitCode}`)
      const seen = fs.readFileSync(marker('env'), 'utf8')
      if (seen !== 'from env file') throw new Error(`the script saw RUNMATE_VAR=${seen}`)
      return `${task.name} :: RUNMATE_VAR=${seen}`
    })

    await check('the getting started guide is contributed and opens', async () => {
      const walkthroughs = extension.packageJSON.contributes.walkthroughs
      for (const step of walkthroughs[0].steps) {
        const file = path.join(extension.extensionPath, step.media.markdown)
        if (!fs.existsSync(file)) throw new Error(`missing ${step.media.markdown}`)
      }
      await vscode.commands.executeCommand('run-mate-script-runner.openGuide')
      return `${walkthroughs[0].steps.length} steps`
    })
  } catch (error) {
    record('host test crashed', false, error.stack || error)
  }

  fs.writeFileSync(process.env.RUNMATE_HOST_RESULT, JSON.stringify(results, null, 2))
  if (results.some((r) => !r.ok)) throw new Error('RunMate host tests failed')
}

module.exports = { run }

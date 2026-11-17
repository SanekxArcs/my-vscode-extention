/**
 * Real runs: plans a run exactly like the extension does, answers "install"
 * to its questions, executes the command line in a real shell and checks
 * what the script saw (which Node, which arguments).
 *
 * This installs Node versions and package managers, so it only runs when
 * RUNMATE_ALLOW_INSTALL=1 is set. It is meant for a container:
 * `npm run test:linux` (see test/docker).
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

if (process.env.RUNMATE_ALLOW_INSTALL !== '1') {
  console.error('Refusing to run: this test installs software. Set RUNMATE_ALLOW_INSTALL=1 (use a container).')
  process.exit(2)
}

const { createStub, install } = require('./vscodeStub')
const { vscode, state } = createStub()
install(vscode)

const shells = require('../src/shells')
const nodeEnv = require('../src/nodeEnv')
const { planRun } = require('../src/runPlan')

/** A version that differs from the Node this test runs on. */
const WANTED = process.versions.node.startsWith('20.') ? '18' : '20'

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    const info = await fn()
    passed++
    console.log(`  ok    ${name}${info ? `\n          ${info}` : ''}`)
  } catch (error) {
    failed++
    console.log(`  FAIL  ${name}\n        ${String(error.stack || error).split('\n').join('\n        ')}`)
  }
}

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run mate switch-'))
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return { dir, folder: { uri: { fsPath: dir } }, name: path.basename(dir), relPath: '' }
}

function execute(plan, cwd) {
  const cmd = plan.shell.kind === 'cmd'
  const args = cmd ? [...plan.shell.args, `"${plan.commandLine}"`] : [...plan.shell.args, plan.commandLine]
  const result = spawnSync(plan.shell.executable, args, {
    cwd,
    encoding: 'utf8',
    windowsVerbatimArguments: cmd,
    timeout: 600000,
  })
  result.all = `${plan.commandLine}\n${result.stdout}\n${result.stderr}`
  return result
}

const npm = (name) => ({ name, script: name, kind: 'npm' })
const SHOW_NODE = `node -e "console.log('NODE=' + process.version)"`
const SHOW_ARGS = `console.log('ARGS=' + process.argv.slice(2).join('+'))\n`

/** Clears earlier questions and queues answers for the next ones. */
function expectQuestions(...answers) {
  state.messages.length = 0
  state.answers.length = 0
  state.answers.push(...answers)
}
const firstButton = (buttons) => buttons[0]

async function main() {
  const cfg = vscode.workspace.getConfiguration()
  const managers = nodeEnv.detectManagers()
  const kinds = (process.platform === 'win32' ? ['pwsh', 'powershell', 'cmd', 'gitbash'] : ['bash', 'zsh', 'fish', 'sh']).filter(
    (kind) => shells.findShellExecutable(kind)
  )
  vscode.env.shell = shells.findShellExecutable(kinds[0])

  console.log(`\nNode ${process.version}, wanted ${WANTED}`)
  console.log(`managers: ${managers.map((m) => m.id).join(', ') || 'none'}`)
  console.log(`shells:   ${kinds.join(', ')}\n`)

  const project = makeProject({ 'package.json': { scripts: { ver: SHOW_NODE } }, '.nvmrc': `${WANTED}\n` })

  for (const manager of managers) {
    state.settings.nodeVersionManager = manager.id === 'nvm-windows' ? 'nvm' : manager.id

    for (const kind of kinds) {
      state.settings.shell = kind
      await test(`${manager.id} in ${kind}: the script runs on Node ${WANTED}`, async () => {
        // If RunMate asks (version not installed yet), choose "Install ... and run".
        expectQuestions(firstButton)
        const plan = await planRun(project, npm('ver'), cfg)
        assert.ok(plan, 'the run was cancelled')
        const asked = state.messages.map((m) => m.message).join(' | ')
        const result = execute(plan, project.dir)
        assert.strictEqual(result.status, 0, result.all)
        const match = /NODE=v(\d+)\./.exec(result.stdout)
        assert.ok(match, result.all)
        assert.strictEqual(match[1], WANTED, result.all)
        return `[${plan.shell.kind}] ${plan.commandLine}${asked ? `\n          asked: ${asked}` : ''}`
      })
    }
  }

  state.settings.nodeVersionManager = 'auto'
  state.settings.shell = 'default'

  await test('no manager is touched when the active Node already matches', async () => {
    const same = makeProject({
      'package.json': { scripts: { ver: SHOW_NODE } },
      '.node-version': `${process.versions.node}\n`,
    })
    expectQuestions()
    const plan = await planRun(same, npm('ver'), cfg)
    assert.ok(!/nvm|fnm|volta/.test(plan.commandLine), plan.commandLine)
    assert.strictEqual(state.messages.length, 0)
    const result = execute(plan, same.dir)
    assert.ok(result.stdout.includes(`NODE=v${process.versions.node}`), result.all)
    return plan.commandLine
  })

  await test('"none" never switches, whatever the project asks for', async () => {
    state.settings.nodeVersionManager = 'none'
    const plan = await planRun(project, npm('ver'), cfg)
    state.settings.nodeVersionManager = 'auto'
    assert.ok(!/nvm|fnm|volta/.test(plan.commandLine), plan.commandLine)
    return plan.commandLine
  })

  await test('engines.node: switches to an installed version that fits, without asking', async () => {
    const next = Number(WANTED) + 1
    const enginesProject = makeProject({
      'package.json': { scripts: { ver: SHOW_NODE }, engines: { node: `>=${WANTED} <${next}` } },
    })
    expectQuestions()
    const plan = await planRun(enginesProject, npm('ver'), cfg)
    assert.strictEqual(state.messages.length, 0, JSON.stringify(state.messages))
    const result = execute(plan, enginesProject.dir)
    assert.ok(result.stdout.includes(`NODE=v${WANTED}.`), result.all)
    return plan.commandLine
  })

  await test('engines.node: nothing installed fits, so RunMate offers to install', async () => {
    const enginesProject = makeProject({
      'package.json': { scripts: { ver: SHOW_NODE }, engines: { node: '^18.12' } },
    })
    expectQuestions(firstButton)
    const plan = await planRun(enginesProject, npm('ver'), cfg)
    assert.strictEqual(state.messages[0].message, `"${enginesProject.name}" needs Node ^18.12`)
    assert.strictEqual(state.messages[0].buttons[0], 'Install Node 18 and run')
    const result = execute(plan, enginesProject.dir)
    assert.ok(result.stdout.includes('NODE=v18.'), result.all)
    return plan.commandLine
  })

  for (const pm of ['pnpm', 'bun', 'yarn']) {
    await test(`${pm} is missing: RunMate offers to install it, then the script runs`, async () => {
      const lockfile = { pnpm: 'pnpm-lock.yaml', bun: 'bun.lock', yarn: 'yarn.lock' }[pm]
      const pmProject = makeProject({ 'package.json': { scripts: { hi: 'echo PM_OK' } }, [lockfile]: '' })
      expectQuestions(firstButton)
      const plan = await planRun(pmProject, npm('hi'), cfg)
      if (!state.messages.length) return 'already installed, skipped'
      assert.ok(state.messages[0].message.includes('was not found on PATH'), JSON.stringify(state.messages))
      assert.ok(plan.commandLine.includes(`npm install -g ${pm}`), plan.commandLine)
      const result = execute(plan, pmProject.dir)
      assert.strictEqual(result.status, 0, result.all)
      assert.ok(result.stdout.includes('PM_OK'), result.all)
      return plan.commandLine
    })
  }

  const lockfiles = { npm: ['package-lock.json', '{}'], pnpm: ['pnpm-lock.yaml', ''], yarn: ['yarn.lock', ''], bun: ['bun.lock', ''] }
  for (const [pm, [lockfile, content]] of Object.entries(lockfiles)) {
    await test(`${pm}: arguments reach the script`, async () => {
      if (!shells.which(pm)) return 'not installed, skipped'
      const argsProject = makeProject({
        'package.json': { scripts: { show: 'node show.js' } },
        'show.js': SHOW_ARGS,
        [lockfile]: content,
      })
      expectQuestions()
      const plan = await planRun(argsProject, npm('show'), cfg, { args: '--watch src' })
      const result = execute(plan, argsProject.dir)
      assert.ok(result.stdout.includes('ARGS=--watch+src'), result.all)
      return plan.commandLine
    })
  }

  const toolProject = makeProject({
    Makefile: 'hello:\n\t@echo MAKE_OK $(WHO)\n',
    justfile: 'hello who="nobody":\n    @echo JUST_OK {{who}}\n',
    'deno.json': { tasks: { hello: 'echo DENO_OK' } },
  })
  const tools = [
    ['make', 'WHO=me', 'MAKE_OK me'],
    ['just', 'me', 'JUST_OK me'],
    ['deno', '', 'DENO_OK'],
  ]
  for (const [kind, args, expected] of tools) {
    await test(`${kind}: the entry runs with its own tool`, async () => {
      if (!shells.which(kind)) return 'not installed, skipped'
      expectQuestions()
      const plan = await planRun(toolProject, { name: 'hello', script: `${kind}:hello`, kind }, cfg, { args })
      const result = execute(plan, toolProject.dir)
      assert.ok(result.stdout.includes(expected), result.all)
      return plan.commandLine
    })
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main()

/**
 * RunMate tests. Plain Node, no test framework: `npm test`.
 *
 *  1. pure logic (shell syntax, Node version rules, ordering, parsers)
 *  2. the generated command lines, executed for real in every shell that is
 *     installed on this machine
 *  3. the extension itself, driven through a stand-in for the vscode API
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawnSync, spawn } = require('child_process')

const { createStub, install } = require('./vscodeStub')
const stub = createStub()
install(stub.vscode)

const shells = require('../src/shells')
const nodeEnv = require('../src/nodeEnv')
const packageUtils = require('../src/packageUtils')
const ordering = require('../src/ordering')
const sources = require('../src/sources')
const { satisfies, suggestMajor } = require('../src/semverLite')
const ports = require('../src/ports')
const envFiles = require('../src/envFiles')

const results = []
async function test(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ok    ${name}`)
  } catch (error) {
    results.push({ name, ok: false })
    console.log(`  FAIL  ${name}\n        ${String(error.stack || error).split('\n').join('\n        ')}`)
  }
}
function skip(name, why) {
  console.log(`  skip  ${name} (${why})`)
}

function tempDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run mate test-'))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

const entry = (name, kind = 'npm') => {
  const script = kind === 'npm' ? name : `${kind}:${name}`
  return { name, kind, script, key: `p::${script}` }
}
const names = (list) => list.map((e) => e.name)

async function main() {
  console.log('\nshell syntax')

  await test('classifies shell executables', () => {
    assert.strictEqual(shells.classifyShell('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32'), 'pwsh')
    assert.strictEqual(shells.classifyShell('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'win32'), 'powershell')
    assert.strictEqual(shells.classifyShell('C:\\WINDOWS\\System32\\cmd.exe', 'win32'), 'cmd')
    assert.strictEqual(shells.classifyShell('C:\\Program Files\\Git\\bin\\bash.exe', 'win32'), 'gitbash')
    assert.strictEqual(shells.classifyShell('C:\\WINDOWS\\System32\\bash.exe', 'win32'), null, 'WSL launcher is not Git Bash')
    assert.strictEqual(shells.classifyShell('/bin/zsh', 'darwin'), 'zsh')
    assert.strictEqual(shells.classifyShell('/usr/bin/fish', 'linux'), 'fish')
    assert.strictEqual(shells.classifyShell('/usr/bin/nu', 'linux'), null)
  })

  await test('unknown default shell falls back to a shell RunMate can write for', () => {
    assert.strictEqual(shells.resolveShell('default', '/usr/bin/nu', {}, 'linux').kind, 'sh')
    assert.strictEqual(shells.resolveShell('default', 'C:\\x\\nu.exe', { ComSpec: 'C:\\cmd.exe' }, 'win32').kind, 'cmd')
  })

  await test('a shell that is not installed falls back to the default', () => {
    assert.strictEqual(shells.resolveShell('fish', '/bin/zsh', { PATH: '' }, 'darwin').kind, 'zsh')
  })

  await test('chains with && except in PowerShell', () => {
    assert.strictEqual(shells.chainCommands('posix', ['a', null, 'b']), 'a && b')
    assert.strictEqual(shells.chainCommands('cmd', ['a', 'b']), 'a && b')
    assert.strictEqual(shells.chainCommands('powershell', ['a']), 'a; exit $LASTEXITCODE')
    assert.strictEqual(
      shells.chainCommands('powershell', ['a', 'b', 'c']),
      'a; if ($?) { b; if ($?) { c } }; exit $LASTEXITCODE'
    )
  })

  await test('quotes only what needs quoting', () => {
    assert.strictEqual(shells.quoteArg('posix', 'build:prod'), 'build:prod')
    assert.strictEqual(shells.quoteArg('posix', "it's; rm -rf"), `'it'\\''s; rm -rf'`)
    assert.strictEqual(shells.quoteArg('powershell', "a b'c"), `'a b''c'`)
    assert.strictEqual(shells.quoteArg('cmd', 'a b'), '"a b"')
    assert.strictEqual(shells.quoteArg('posix', 'lts/*'), `'lts/*'`)
  })

  console.log('\nNode version rules')

  await test('parses version specs and aliases', () => {
    assert.deepStrictEqual(nodeEnv.parseSpec('v20.11.1').parts, [20, 11, 1])
    assert.deepStrictEqual(nodeEnv.parseSpec('20').parts, [20])
    assert.deepStrictEqual(nodeEnv.parseSpec('20.x').parts, [20])
    assert.strictEqual(nodeEnv.parseSpec('lts/*').kind, 'alias')
    assert.strictEqual(nodeEnv.parseSpec('lts/iron').kind, 'alias')
  })

  await test('matches the active version against a spec', () => {
    assert.ok(nodeEnv.versionMatches(nodeEnv.parseSpec('20'), 'v20.11.1'))
    assert.ok(nodeEnv.versionMatches(nodeEnv.parseSpec('20.11'), 'v20.11.1'))
    assert.ok(!nodeEnv.versionMatches(nodeEnv.parseSpec('20.12'), 'v20.11.1'))
    assert.ok(!nodeEnv.versionMatches(nodeEnv.parseSpec('2'), 'v20.11.1'))
    assert.ok(!nodeEnv.versionMatches(nodeEnv.parseSpec('lts/*'), 'v20.11.1'), 'aliases always go to the manager')
    assert.ok(!nodeEnv.versionMatches(nodeEnv.parseSpec('20'), null))
  })

  await test('picks the highest installed match', () => {
    const versions = ['v18.20.4', 'v20.9.0', 'v20.11.1', 'v22.1.0']
    assert.strictEqual(nodeEnv.bestInstalledMatch(nodeEnv.parseSpec('20'), versions), 'v20.11.1')
    assert.strictEqual(nodeEnv.bestInstalledMatch(nodeEnv.parseSpec('16'), versions), null)
  })

  await test('finds the version file, also in a parent folder', async () => {
    const root = tempDir({
      '.nvmrc': '# comment\nv20.11.0\n',
      'apps/web/package.json': {},
      'apps/api/.node-version': '18\n',
      'apps/tools/.tool-versions': 'python 3.12\nnodejs 22.3.0\n',
      'apps/pinned/package.json': { volta: { node: '21.1.0' } },
    })
    const find = (rel) => nodeEnv.findNodeSpec(path.join(root, rel), root)
    assert.strictEqual((await find('apps/web')).raw, 'v20.11.0')
    assert.strictEqual((await find('apps/web')).source, '.nvmrc')
    assert.strictEqual((await find('apps/api')).raw, '18')
    assert.strictEqual((await find('apps/tools')).raw, '22.3.0')
    assert.strictEqual((await find('apps/pinned')).raw, '21.1.0')
    assert.strictEqual(await nodeEnv.findNodeSpec(tempDir({ 'package.json': {} }), undefined), null)
  })

  await test('reads engines.node ranges', () => {
    const cases = [
      ['>=18', 'v22.1.0', true],
      ['>=18', 'v16.20.0', false],
      ['^20.10', 'v20.9.0', false],
      ['^20.10', 'v20.11.1', true],
      ['18 || 20', 'v19.0.0', false],
      ['18 || 20', 'v20.1.0', true],
      ['>=18 <21', 'v21.0.0', false],
      ['20.x', 'v20.5.0', true],
      ['>= 18.17.0', 'v18.16.0', false],
      ['~18.17', 'v18.17.5', true],
      ['18 - 20', 'v20.5.0', true],
      ['>18', 'v18.5.0', false],
      ['<=20', 'v20.9.0', true],
      ['*', 'v1.0.0', true],
      ['whatever', 'v20.0.0', null],
    ]
    for (const [range, version, expected] of cases) {
      assert.strictEqual(satisfies(range, version), expected, `${range} with ${version}`)
    }
    assert.strictEqual(suggestMajor('>=18 <21'), 18)
    assert.strictEqual(suggestMajor('18 || 20'), 20)
    assert.strictEqual(suggestMajor('*'), null)
  })

  await test('writes the switch commands for each manager and shell', () => {
    const spec = nodeEnv.parseSpec('20')
    const sh = { kind: 'bash', family: 'posix' }
    const ps = { kind: 'powershell', family: 'powershell' }
    const cmd = { kind: 'cmd', family: 'cmd' }
    const fish = { kind: 'fish', family: 'fish' }

    assert.deepStrictEqual(nodeEnv.buildActivation({ id: 'fnm' }, sh, spec).setup, [
      'eval "$(fnm env --shell bash)"',
      'fnm use 20',
    ])
    assert.deepStrictEqual(nodeEnv.buildActivation({ id: 'fnm' }, ps, spec, { install: true }).setup, [
      'fnm env | Out-String | Invoke-Expression',
      'fnm use 20 --install-if-missing',
    ])
    assert.ok(nodeEnv.buildActivation({ id: 'fnm' }, cmd, spec).setup[0].startsWith('(FOR /f'))
    assert.strictEqual(nodeEnv.buildActivation({ id: 'fnm' }, fish, spec).setup[0], 'fnm env --shell fish | source')

    assert.deepStrictEqual(
      nodeEnv.buildActivation({ id: 'nvm', script: '/Users/a b/.nvm/nvm.sh' }, sh, spec, { install: true }).setup,
      [`. '/Users/a b/.nvm/nvm.sh'`, 'nvm install 20']
    )

    // nvm for Windows gets the exact installed version, not "20".
    assert.deepStrictEqual(
      nodeEnv.buildActivation({ id: 'nvm-windows' }, ps, spec, { resolvedVersion: 'v20.11.1' }).setup,
      ['nvm use 20.11.1']
    )
    assert.deepStrictEqual(nodeEnv.buildActivation({ id: 'nvm-windows' }, ps, spec, { install: true }).setup, [
      'nvm install 20',
      'nvm use 20',
    ])
    assert.deepStrictEqual(nodeEnv.buildActivation({ id: 'nvm-windows' }, ps, nodeEnv.parseSpec('lts/*')).setup, [
      'nvm use lts',
    ])

    const volta = nodeEnv.buildActivation({ id: 'volta' }, sh, spec)
    assert.deepStrictEqual(volta.setup, [])
    assert.strictEqual(volta.wrap('pnpm run dev'), 'volta run --node 20 pnpm run dev')
  })

  console.log('\nscript sources')

  await test('reads Deno tasks', () => {
    const text = '{ // comment\n "tasks": { "dev": "deno run -A main.ts", "build": { "command": "deno compile main.ts", "description": "x" }, "bad": 5 } }'
    assert.deepStrictEqual(sources.parseDenoTasks(text), [
      { name: 'dev', command: 'deno run -A main.ts' },
      { name: 'build', command: 'deno compile main.ts' },
    ])
    assert.deepStrictEqual(sources.parseDenoTasks('not json'), [])
  })

  await test('reads Makefile targets a person would run', () => {
    const text = [
      'CC := gcc',
      'OUT = dist',
      '.PHONY: build test',
      'build: deps',
      '\t@go build ./...',
      'test lint:',
      '\tgo test ./...',
      '%.o: %.c',
      '\t$(CC) -c $<',
      'dist/app.js: src/app.ts',
      '\ttsc',
      'deps:',
      'build: more',
    ].join('\n')
    assert.deepStrictEqual(sources.parseMakeTargets(text), [
      { name: 'build', command: 'go build ./...' },
      { name: 'test', command: 'go test ./...' },
      { name: 'lint', command: 'go test ./...' },
      { name: 'deps', command: 'make deps' },
    ])
  })

  await test('reads just recipes', () => {
    const text = [
      'set shell := ["bash", "-c"]',
      'version := "1.0"',
      'alias b := build',
      '# Build it',
      'build target="debug": lint',
      '    cargo build --{{target}}',
      '@lint:',
      '    cargo clippy',
      '_private:',
      '    echo no',
      'serve port:',
      '    python -m http.server {{port}}',
    ].join('\n')
    assert.deepStrictEqual(sources.parseJustRecipes(text), [
      { name: 'build', command: 'cargo build --{{target}}' },
      { name: 'lint', command: 'cargo clippy' },
      { name: 'serve', command: 'python -m http.server {{port}}' },
    ])
  })

  await test('reads the package folders a monorepo declares', () => {
    assert.deepStrictEqual(sources.parseWorkspaceGlobs(JSON.stringify({ workspaces: ['apps/*', './packages/**/', '!apps/old'] }), null), [
      'apps/*',
      'packages/**',
    ])
    assert.deepStrictEqual(sources.parseWorkspaceGlobs(JSON.stringify({ workspaces: { packages: ['libs/*'] } }), null), ['libs/*'])
    const yaml = "# pnpm\npackages:\n  - 'apps/*'\n  # comment\n  - \"tools/deep/**\"\n  - '!**/test/**'\ncatalog:\n  react: 19\n"
    assert.deepStrictEqual(sources.parseWorkspaceGlobs('{}', yaml), ['apps/*', 'tools/deep/**'])
    assert.deepStrictEqual(sources.parsePnpmWorkspace("packages: ['a/*', \"b\"]"), ['a/*', 'b'])
  })

  console.log('\npackage manager detection')

  await test('a nested package uses the lockfile of the repository root', async () => {
    const root = tempDir({
      'package.json': { private: true },
      'pnpm-lock.yaml': '',
      'packages/ui/package.json': { scripts: { dev: 'x' } },
      'apps/legacy/package.json': { packageManager: 'yarn@1.22.19' },
      'apps/bun/package.json': {},
      'apps/bun/bun.lock': '',
    })
    const detect = (rel) => packageUtils.detectPackageManager(path.join(root, rel), root)
    assert.strictEqual((await detect('packages/ui')).pm, 'pnpm')
    assert.strictEqual((await detect('packages/ui')).rootDir, root)
    assert.strictEqual((await detect('apps/legacy')).pm, 'yarn')
    assert.strictEqual((await detect('apps/bun')).pm, 'bun')
    assert.strictEqual((await packageUtils.detectPackageManager(tempDir({ 'package.json': {} }))).pm, 'npm')
  })

  await test('hoisted dependencies count as installed', async () => {
    const root = tempDir({ 'node_modules/.keep': '', 'packages/ui/package.json': {} })
    const ui = path.join(root, 'packages/ui')
    assert.strictEqual(await packageUtils.checkDependenciesInstalled(ui, 'pnpm', root), true)
    assert.strictEqual(await packageUtils.checkDependenciesInstalled(ui, 'pnpm', ui), false)
    const pnp = tempDir({ '.pnp.cjs': '' })
    assert.strictEqual(await packageUtils.checkDependenciesInstalled(pnp, 'yarn-berry', pnp), true)
    assert.strictEqual(await packageUtils.checkDependenciesInstalled(pnp, 'npm', pnp), false)
  })

  console.log('\nordering')

  await test('my order wins, then scriptOrder, then package.json before other sources, then the alphabet', () => {
    const entries = ['lint', 'zeta', 'build', 'alpha', 'dev'].map((n) => entry(n))
    assert.deepStrictEqual(names(ordering.sortEntries(entries, [], ['dev', 'build'])), ['dev', 'build', 'alpha', 'lint', 'zeta'])
    assert.deepStrictEqual(names(ordering.sortEntries(entries, ['zeta', 'lint'], ['dev', 'build'])), ['zeta', 'lint', 'dev', 'build', 'alpha'])
    const mixed = [entry('build', 'make'), entry('zeta'), entry('build'), entry('alpha', 'just')]
    assert.deepStrictEqual(
      ordering.sortEntries(mixed, [], ['build']).map((e) => e.script),
      ['build', 'make:build', 'zeta', 'just:alpha']
    )
  })

  await test('moving stays inside the block and stops at its edge', () => {
    const entries = ['a', 'b', 'c', 'd'].map((n) => entry(n))
    const state = { favorites: new Set(['p::c']), hidden: new Set(['p::d']), customOrder: [], scriptOrder: [] }
    const arranged = ordering.arrange(entries, state)
    assert.deepStrictEqual(names(arranged.favorites), ['c'])
    assert.deepStrictEqual(names(arranged.others), ['a', 'b'])
    assert.deepStrictEqual(names(arranged.hidden), ['d'])
    assert.deepStrictEqual(ordering.moveEntry(arranged, entry('a'), 1), ['c', 'b', 'a', 'd'])
    assert.strictEqual(ordering.moveEntry(arranged, entry('a'), -1), null, 'cannot move above the favorites')
    assert.strictEqual(ordering.moveEntry(arranged, entry('c'), 1), null, 'a single favorite has nowhere to go')
  })

  console.log('\ngenerated command lines, run in real shells')

  // A project whose folder name has a space, like many Windows home folders.
  const project = tempDir({
    'package.json': { scripts: { hello: 'node -e "console.log(\'RUNMATE_OK\')"', boom: 'node -e "process.exit(7)"' } },
  })
  const kinds = process.platform === 'win32' ? ['pwsh', 'powershell', 'cmd', 'gitbash'] : ['bash', 'zsh', 'fish', 'sh']
  const hasFnm = Boolean(shells.which('fnm'))

  for (const kind of kinds) {
    const executable = shells.findShellExecutable(kind)
    if (!executable) {
      skip(kind, 'not installed')
      continue
    }
    const shell = shells.resolveShell(kind, executable)
    const exec = (segments) => {
      const line = shells.chainCommands(shell.family, segments)
      // cmd.exe parses its own command line; Node must not re-quote it.
      const options = { cwd: project, encoding: 'utf8', windowsVerbatimArguments: shell.kind === 'cmd' }
      const args = shell.kind === 'cmd' ? [...shell.args, `"${line}"`] : [...shell.args, line]
      return spawnSync(shell.executable, args, options)
    }

    await test(`${shell.label}: runs a chain of commands`, () => {
      const result = exec(['node --version', 'npm run hello'])
      assert.strictEqual(result.status, 0, result.stderr)
      assert.ok(result.stdout.includes('RUNMATE_OK'), result.stdout)
    })

    await test(`${shell.label}: stops the chain when a command fails`, () => {
      const result = exec(['npm run boom', 'npm run hello'])
      assert.notStrictEqual(result.status, 0)
      assert.ok(!result.stdout.includes('RUNMATE_OK'), 'the second command must not run')
    })

    if (hasFnm) {
      await test(`${shell.label}: loads the fnm environment`, () => {
        const [envCommand] = nodeEnv.buildActivation({ id: 'fnm' }, shell, nodeEnv.parseSpec('20')).setup
        const result = exec([envCommand, 'npm run hello'])
        assert.strictEqual(result.status, 0, result.stderr)
        assert.ok(result.stdout.includes('RUNMATE_OK'), result.stdout)
      })
    }
  }

  console.log('\nports and env files')

  await test('works out the port of a script, most certain source first', () => {
    const guess = (command, options) => ports.guessPort({ name: 'dev', script: 'dev', command }, options)
    assert.deepStrictEqual(guess('vite'), { port: 5173, source: 'the usual port of Vite' })
    assert.strictEqual(guess('vite --port 3001').port, 3001)
    assert.strictEqual(guess('vite --port=3002').port, 3002)
    assert.strictEqual(guess('next dev -p 4000').port, 4000)
    assert.strictEqual(guess('cross-env PORT=5000 node server.js').port, 5000)
    assert.strictEqual(guess('next dev').port, 3000)
    assert.strictEqual(guess('ng serve').port, 4200)
    assert.strictEqual(guess('vite preview').port, 4173)
    assert.strictEqual(guess('vite', { args: '--port 9000' }).port, 9000, 'arguments win over the command')
    assert.strictEqual(guess('node server.js', { env: { PORT: '8123' }, envFile: '.env.local' }).source, 'PORT in .env.local')
    assert.strictEqual(guess('vite --port 3001', { overrides: { dev: 7000 } }).port, 7000, 'the setting wins over everything')
    for (const command of ['vite build', 'vitest', 'vite-node x.ts', 'next build', 'tsc -p tsconfig.json', 'node server.js', '']) {
      assert.strictEqual(guess(command), null, command)
    }
  })

  await test('sees a busy port and finds the process that holds it', async () => {
    const server = await new Promise((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => resolve(s))
    })
    const port = server.address().port
    assert.strictEqual(await ports.isPortBusy(port), true)
    const owner = await ports.findOwner(port)
    if (owner) assert.strictEqual(owner.pid, process.pid)
    else console.log('          (no tool here to find the owner of a port)')
    await new Promise((resolve) => server.close(resolve))
    assert.strictEqual(await ports.isPortBusy(port), false)
  })

  await test('reads env files: quotes, comments, export, multi-line values', () => {
    const env = envFiles.parseEnv(
      [
        '# a comment',
        'PLAIN=value',
        'SPACED = spaced value   # trailing comment',
        'export EXPORTED=yes',
        'EMPTY=',
        'SINGLE=\'keeps # and "quotes"\'',
        'DOUBLE="line one\\nline two"',
        'URL=https://example.com/a?b=c',
        'MULTI="first',
        'second"',
        'not a variable',
        '',
      ].join('\r\n')
    )
    assert.deepStrictEqual(env, {
      PLAIN: 'value',
      SPACED: 'spaced value',
      EXPORTED: 'yes',
      EMPTY: '',
      SINGLE: 'keeps # and "quotes"',
      DOUBLE: 'line one\nline two',
      URL: 'https://example.com/a?b=c',
      MULTI: 'first\r\nsecond',
    })
  })

  console.log('\nextension')
  await extensionTests()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
  process.exit(failed.length ? 1 : 0)
}

async function extensionTests() {
  const { vscode, state, uri } = stub
  const settle = () => new Promise((resolve) => setTimeout(resolve, 450))
  const reconfigure = async (changes) => {
    Object.assign(state.settings, changes)
    vscode.workspace.onDidChangeConfiguration.fire({ affectsConfiguration: () => true })
    await settle()
  }

  // A monorepo: a root project, packages declared in "workspaces" (one of
  // them deeper than the search depth), and a folder with only a Makefile.
  const repo = tempDir({
    'package.json': {
      name: 'root',
      workspaces: ['apps/*', 'tools/very/deep/*'],
      scripts: { dev: 'turbo dev', build: 'turbo build', 'build:prod': 'x', 'build.prod': 'y' },
    },
    'pnpm-lock.yaml': '',
    'node_modules/.keep': '',
    'node_modules/dep/package.json': { scripts: { nope: 'x' } },
    'apps/web/package.json': { scripts: { dev: 'vite', lint: 'eslint .', test: 'vitest' }, devDependencies: { vite: '1' } },
    'apps/web/Makefile': 'deploy:\n\t./deploy.sh\n',
    'apps/docs/package.json': { scripts: { serve: 'node serve.js' } },
    'apps/fresh/package.json': { scripts: { dev: 'vite' }, dependencies: { vite: '1' } },
    'apps/fresh/package-lock.json': '{}',
    'apps/api/package.json': { scripts: { dev: 'bun --watch index.ts', seed: 'bun seed.ts' } },
    'apps/api/bun.lock': '',
    'apps/api/node_modules/.keep': '',
    'apps/empty/package.json': { name: 'no-scripts' },
    'tools/very/deep/cli/package.json': { scripts: { build: 'tsc' } },
    'infra/justfile': 'up:\n    docker compose up\n',
    'edge/deno.json': { tasks: { start: 'deno run -A main.ts' } },
  })
  const dirOf = (rel) => path.join(repo, ...rel.split('/'))
  const idOf = (rel, script) => `${rel ? dirOf(rel) : repo}::${script}`
  const folder = { uri: uri(repo), name: 'repo', index: 0 }
  vscode.workspace.workspaceFolders = [folder]

  const memento = (initial = {}) => {
    const data = new Map(Object.entries(initial))
    return {
      get: (key, fallback) => (data.has(key) ? data.get(key) : fallback),
      update: async (key, value) => void data.set(key, value),
    }
  }
  // A star saved by a version before 1.5, which kept favorites globally.
  const context = {
    subscriptions: [],
    globalState: memento({ 'run-mate.favorites': ['repo::build'] }),
    workspaceState: memento(),
  }

  state.settings.maxProjectButtons = 20
  // Whatever happens to listen on this machine must not change the results;
  // the port tests switch the check back on with a port of their own.
  state.settings.checkPorts = false
  require('../extension').activate(context)
  await settle()

  const texts = () => state.statusItems.map((item) => item.text)
  const run = (id, ...args) => vscode.commands.executeCommand('run-mate-script-runner.runScript', id, ...args)
  const stopAll = () => state.taskExecutions.slice().forEach((execution) => execution.terminate())
  const lastLine = () => state.executedTasks[state.executedTasks.length - 1].execution.commandLine
  const openPicker = async (projectId) => {
    await vscode.commands.executeCommand(
      projectId ? 'run-mate-script-runner.showProjectScripts' : 'run-mate-script-runner.showAllScripts',
      projectId
    )
    return state.quickPicks[state.quickPicks.length - 1]
  }
  const runAnyway = (buttons) => buttons.find((label) => label === 'Run anyway')
  const labels = (qp) => qp.items.map((item) => (item.kind === -1 ? `--- ${item.label}` : item.label))
  const press = async (qp, name, action) => {
    const item = qp.items.find((i) => i.entry?.name === name || i.runGroup?.name === name)
    await qp.handlers.itemButton({ item, button: item.buttons.find((b) => b.action === action) })
  }

  await test('finds projects: root, subfolders, declared monorepo packages at any depth', () => {
    assert.deepStrictEqual(texts(), [
      '$(package) repo',
      '$(package) edge',
      '$(package) infra',
      '$(package) api',
      '$(package) docs',
      '$(package) fresh',
      '$(package) web',
      '$(package) cli',
    ])
  })

  await test('project buttons are capped by maxProjectButtons', async () => {
    await reconfigure({ maxProjectButtons: 3 })
    assert.deepStrictEqual(texts(), ['$(package) repo', '$(package) edge', '$(package) infra', '$(ellipsis) +5'])
    await reconfigure({ maxProjectButtons: 20 })
  })

  await test('a project button lists only that project; other sources say where they come from', async () => {
    const qp = await openPicker(dirOf('apps/web'))
    // "test" is excluded by the default excludeScripts setting.
    assert.deepStrictEqual(labels(qp), ['dev', 'lint', 'deploy'])
    assert.strictEqual(qp.items[0].description, 'vite')
    assert.strictEqual(qp.items[2].description, 'make: ./deploy.sh')
    qp.hide()
  })

  await test('the full list groups scripts by project and skips node_modules', async () => {
    const qp = await openPicker()
    assert.deepStrictEqual(labels(qp), [
      '--- repo', '$(star-full) build', 'dev', 'build:prod', 'build.prod',
      '--- edge', 'start',
      '--- infra', 'up',
      '--- api', 'dev', 'seed',
      '--- docs', 'serve',
      '--- fresh', 'dev',
      '--- web', 'dev', 'lint', 'deploy',
      '--- cli', 'build',
    ])
    qp.hide()
  })

  await test('script sources can be switched off', async () => {
    await reconfigure({ scriptSources: ['npm'] })
    assert.ok(!texts().includes('$(package) infra') && !texts().includes('$(package) edge'), texts().join(' | '))
    const qp = await openPicker(dirOf('apps/web'))
    assert.deepStrictEqual(labels(qp), ['dev', 'lint'])
    qp.hide()
    await reconfigure({ scriptSources: ['npm', 'deno', 'make', 'just'] })
  })

  await test('hide, star and move work from the list and persist; old global stars are kept', async () => {
    let qp = await openPicker(repo)
    assert.deepStrictEqual(labels(qp), ['$(star-full) build', 'dev', 'build:prod', 'build.prod'])

    await press(qp, 'build.prod', 'hide')
    assert.deepStrictEqual(labels(qp), ['$(star-full) build', 'dev', 'build:prod', '--- Hidden', 'build.prod'])
    assert.strictEqual(qp.activeItems[0].entry.name, 'build.prod', 'the row stays selected')

    await press(qp, 'build:prod', 'star')
    assert.deepStrictEqual(labels(qp), ['$(star-full) build', '$(star-full) build:prod', 'dev', '--- Hidden', 'build.prod'])
    assert.deepStrictEqual(context.workspaceState.get('run-mate.favorites').sort(), ['repo::build', 'repo::build:prod'])
    assert.deepStrictEqual(context.globalState.get('run-mate.favorites'), ['repo::build'], 'global stars are not modified')

    await press(qp, 'build:prod', 'up')
    assert.deepStrictEqual(labels(qp).slice(0, 3), ['$(star-full) build:prod', '$(star-full) build', 'dev'])
    await press(qp, 'build:prod', 'up')
    assert.strictEqual(labels(qp)[0], '$(star-full) build:prod', 'already first in its block')
    qp.hide()

    qp = await openPicker(repo)
    assert.deepStrictEqual(labels(qp), ['$(star-full) build:prod', '$(star-full) build', 'dev', '--- Hidden', 'build.prod'])
    await press(qp, 'build.prod', 'hide')
    assert.ok(!labels(qp).includes('--- Hidden'))
    qp.hide()
  })

  await test('a nested script runs from its own folder with its own package manager', async () => {
    state.settings.preflightChecks = false
    const qp = await openPicker(dirOf('apps/api'))
    qp.selectedItems = [qp.items.find((i) => i.entry?.name === 'seed')]
    qp.handlers.accept()
    await settle()
    const task = state.executedTasks[state.executedTasks.length - 1]
    assert.strictEqual(task.execution.options.cwd, dirOf('apps/api'))
    assert.ok(task.execution.commandLine.includes('bun run seed'), task.execution.commandLine)
    assert.ok(!task.execution.commandLine.includes('install'), 'node_modules exists, nothing to install')
    assert.ok(task.execution.options.executable, 'the shell is always explicit')
    assert.strictEqual(task.name, 'seed (api)')
    stopAll()
  })

  await test('the root package manager is used for a nested package without a lockfile', async () => {
    await run(idOf('apps/web', 'lint'))
    assert.ok(lastLine().includes('pnpm run lint'), lastLine())
    assert.ok(!lastLine().includes('pnpm install'), 'dependencies are hoisted to the root')
    stopAll()
  })

  await test('dependencies are installed first only when there are some and they are missing', async () => {
    await run(idOf('apps/fresh', 'dev'))
    assert.ok(lastLine().includes('npm install') && lastLine().includes('npm run dev'), lastLine())
    await run(idOf('apps/docs', 'serve'))
    assert.ok(!lastLine().includes('install'), 'no dependencies declared: ' + lastLine())
    stopAll()
  })

  await test('Makefile targets, just recipes and Deno tasks run with their own tool', async () => {
    await run(idOf('apps/web', 'make:deploy'))
    assert.ok(/^make deploy/.test(lastLine()), lastLine())
    assert.strictEqual(state.executedTasks[state.executedTasks.length - 1].name, 'make deploy (web)')
    await run(idOf('infra', 'just:up'))
    assert.ok(/^just up/.test(lastLine()), lastLine())
    await run(idOf('edge', 'deno:start'))
    assert.ok(/^deno task start/.test(lastLine()), lastLine())
    stopAll()
  })

  await test('a missing tool is reported before the run, and cancel runs nothing', async () => {
    if (shells.which('just')) return
    state.settings.preflightChecks = true
    const before = state.executedTasks.length
    state.messages.length = 0
    state.answers.push(undefined)
    await run(idOf('infra', 'just:up'))
    assert.strictEqual(state.executedTasks.length, before)
    assert.strictEqual(state.messages[0].message, 'just was not found on PATH')
    assert.deepStrictEqual(state.messages[0].buttons, ['Open install guide', 'Run anyway'])
    state.settings.preflightChecks = false
  })

  await test('a running script shows on its project button and can be stopped from the list', async () => {
    await run(idOf('apps/api', 'seed'))
    assert.ok(texts().includes('$(sync~spin) api'), texts().join(' | '))
    const qp = await openPicker(dirOf('apps/api'))
    assert.ok(labels(qp).includes('$(sync~spin) seed'))
    await press(qp, 'seed', 'stop')
    assert.ok(texts().includes('$(package) api'))
    qp.hide()
    stopAll()
  })

  await test('run with options: another shell for one run', async () => {
    const available = shells.listShells(vscode.env.shell).filter((s) => s.id !== 'default')
    const other = available[available.length - 1]
    const qp = await openPicker(dirOf('apps/web'))
    state.answers.push((items) => items.find((item) => item.shell === other.id))
    await press(qp, 'dev', 'options')
    await settle()
    const task = state.executedTasks[state.executedTasks.length - 1]
    assert.strictEqual(task.execution.options.executable, other.detail)
    assert.strictEqual(state.settings.shell, 'default', 'the setting is untouched')
    stopAll()
  })

  await test('run with options: arguments are passed on and remembered', async () => {
    let qp = await openPicker(repo)
    state.answers.push((items) => items.find((item) => item.id === 'args'), '--filter web  ')
    await press(qp, 'dev', 'options')
    await settle()
    assert.ok(lastLine().includes('pnpm run dev --filter web'), lastLine())
    stopAll()

    // npm needs "--" before the arguments.
    qp = await openPicker(dirOf('apps/fresh'))
    state.answers.push((items) => items.find((item) => item.id === 'args'), '--port 4000')
    await press(qp, 'dev', 'options')
    await settle()
    assert.ok(lastLine().includes('npm run dev -- --port 4000'), lastLine())
    stopAll()

    // The arguments are offered again next time.
    qp = await openPicker(repo)
    let offered
    state.answers.push((items) => {
      offered = items.map((item) => item.label)
      return items.find((item) => item.args === '--filter web')
    })
    await press(qp, 'dev', 'options')
    await settle()
    assert.ok(offered.includes('$(history) --filter web'), offered.join(' | '))
    assert.ok(lastLine().includes('pnpm run dev --filter web'), lastLine())
    stopAll()
  })

  await test('"Run Last Script Again" repeats the last run, arguments included', async () => {
    const before = state.executedTasks.length
    await vscode.commands.executeCommand('run-mate-script-runner.runLastScript')
    assert.strictEqual(state.executedTasks.length, before + 1)
    assert.ok(lastLine().includes('pnpm run dev --filter web'), lastLine())
    stopAll()
  })

  await test('a group starts several scripts with one click and stops them again', async () => {
    // Tick web:dev and api:dev, name the group.
    state.answers.push(
      (items) => items.filter((item) => item.label === 'dev' && /^(web|api) /.test(item.description)),
      'dev all'
    )
    await vscode.commands.executeCommand('run-mate-script-runner.newGroup')
    assert.strictEqual(texts()[0], '$(run-all) dev all')

    const button = state.statusItems[0]
    const before = state.executedTasks.length
    await vscode.commands.executeCommand(button.command.command, ...button.command.arguments)
    const started = state.executedTasks.slice(before).map((task) => task.name).sort()
    assert.deepStrictEqual(started, ['dev (api)', 'dev (web)'])
    assert.strictEqual(button.text, '$(stop-circle) dev all')

    const qp = await openPicker()
    assert.deepStrictEqual(labels(qp).slice(0, 3), ['--- Groups', '$(sync~spin) dev all', '--- repo'])
    assert.strictEqual(qp.items[1].description, 'api: dev, web: dev')
    qp.hide()

    await vscode.commands.executeCommand(button.command.command, ...button.command.arguments)
    assert.strictEqual(button.text, '$(run-all) dev all')
    assert.strictEqual(state.taskExecutions.length, 0)

    const again = await openPicker()
    await press(again, 'dev all', 'deleteGroup')
    assert.ok(!labels(again).includes('--- Groups'))
    assert.ok(!texts().includes('$(run-all) dev all'))
    again.hide()
  })

  await test('layout "scripts": favorites first, colliding names get their own buttons, 0 is allowed', async () => {
    await reconfigure({ statusBarLayout: 'scripts', nestedProjects: false })
    assert.deepStrictEqual(texts(), ['$(gear) build:prod', '$(gear) build', '$(play) dev', '$(gear) build.prod', '$(ellipsis)'])

    await reconfigure({ maxDynamicScriptButtons: 2 })
    assert.deepStrictEqual(texts(), ['$(gear) build:prod', '$(gear) build', '$(ellipsis) +2'])

    await reconfigure({ maxDynamicScriptButtons: 0 })
    assert.deepStrictEqual(texts(), ['$(ellipsis) +4'])
    await reconfigure({ maxDynamicScriptButtons: 8 })
  })

  await test('a script button becomes a stop button while its script runs', async () => {
    const button = state.statusItems.find((item) => item.text === '$(play) dev')
    await vscode.commands.executeCommand(button.command.command, ...button.command.arguments)
    await settle()
    assert.strictEqual(button.text, '$(stop-circle) dev')
    await vscode.commands.executeCommand(button.command.command, ...button.command.arguments)
    assert.strictEqual(button.text, '$(play) dev')
  })

  await test('a missing Node version is offered for install, and cancel does not run anything', async () => {
    state.settings.preflightChecks = true
    const managers = nodeEnv.detectManagers()
    if (!managers.length) return
    fs.writeFileSync(path.join(repo, '.nvmrc'), '9.9.9\n')
    const before = state.executedTasks.length
    state.messages.length = 0

    state.answers.push(undefined) // Escape on the question
    await run(idOf('', 'dev'))
    assert.strictEqual(state.executedTasks.length, before, 'cancelled')
    assert.ok(state.messages[0].message.includes('wants Node 9.9.9 (from .nvmrc)'), JSON.stringify(state.messages))
    assert.ok(state.messages[0].buttons[0].startsWith('Install Node 9.9.9'))

    state.answers.push((buttons) => buttons[0]) // Install and run
    await run(idOf('', 'dev'))
    fs.rmSync(path.join(repo, '.nvmrc'))
    assert.strictEqual(state.executedTasks.length, before + 1)
    assert.ok(/nvm install 9\.9\.9|fnm use 9\.9\.9 --install-if-missing/.test(lastLine()), lastLine())
    assert.ok(lastLine().includes('pnpm run dev'), lastLine())
    stopAll()
  })

  await test('no switch command when the active Node already matches', async () => {
    const current = await nodeEnv.getCurrentNodeVersion()
    if (!current) return
    fs.writeFileSync(path.join(repo, '.nvmrc'), `${current.split('.')[0]}\n`)
    const before = state.executedTasks.length
    state.messages.length = 0
    state.answers.push(runAnyway) // only used if the package manager is missing on this machine
    await run(idOf('', 'dev'))
    state.answers.length = 0
    fs.rmSync(path.join(repo, '.nvmrc'))
    assert.strictEqual(state.executedTasks.length, before + 1)
    assert.ok(!state.messages.some((m) => m.message.includes('Node')), JSON.stringify(state.messages))
    assert.ok(!/nvm|fnm|volta/.test(lastLine()), lastLine())
    stopAll()
  })

  await test('engines.node that the active Node does not fit is reported', async () => {
    const current = await nodeEnv.getCurrentNodeVersion()
    if (!current) return
    const rootPackage = path.join(repo, 'package.json')
    const original = fs.readFileSync(rootPackage, 'utf8')
    fs.writeFileSync(rootPackage, JSON.stringify({ ...JSON.parse(original), engines: { node: '>=998 <999' } }))
    const before = state.executedTasks.length
    state.messages.length = 0
    state.answers.push(undefined)
    await run(idOf('', 'dev'))
    assert.strictEqual(state.executedTasks.length, before, 'cancelled')
    assert.strictEqual(state.messages[0].message, '"repo" needs Node >=998 <999')
    assert.ok(state.messages[0].buttons.some((label) => label.startsWith('Run with Node ')), JSON.stringify(state.messages[0]))

    // A range the active Node fits: no question, no switch.
    fs.writeFileSync(rootPackage, JSON.stringify({ ...JSON.parse(original), engines: { node: '>=1' } }))
    state.messages.length = 0
    state.answers.push(runAnyway)
    await run(idOf('', 'dev'))
    state.answers.length = 0
    fs.writeFileSync(rootPackage, original)
    assert.strictEqual(state.executedTasks.length, before + 1)
    assert.ok(!state.messages.some((m) => m.message.includes('Node')), JSON.stringify(state.messages))
    assert.ok(!/nvm|fnm|volta/.test(lastLine()), lastLine())
    stopAll()
  })

  // ---- ports, failures, env files, shared groups ------------------------

  state.settings.preflightChecks = false
  await reconfigure({ statusBarLayout: 'auto', nestedProjects: true })
  const lastTask = () => state.executedTasks[state.executedTasks.length - 1]
  const listen = () =>
    new Promise((resolve) => {
      const server = net.createServer().listen(0, '127.0.0.1', () => resolve(server))
    })

  await test('a busy port is reported before the run, with the program that holds it', async () => {
    const server = await listen()
    const port = server.address().port
    await reconfigure({ checkPorts: true, scriptPorts: { serve: port } })
    const before = state.executedTasks.length

    state.messages.length = 0
    state.answers.push(undefined) // Escape
    await run(idOf('apps/docs', 'serve'))
    assert.strictEqual(state.executedTasks.length, before, 'cancelled')
    const [question] = state.messages
    assert.strictEqual(question.message, `Port ${port} is already in use`)
    assert.ok(question.detail.includes(`'serve' in docs is expected to start on port ${port}`), question.detail)
    // This test process holds the port, and RunMate must not offer to stop itself.
    assert.deepStrictEqual(question.buttons, ['Run anyway'])
    const owner = await ports.findOwner(port)
    if (owner) assert.ok(question.detail.includes(`process ${process.pid}`), question.detail)

    state.answers.push(runAnyway)
    await run(idOf('apps/docs', 'serve'))
    assert.strictEqual(state.executedTasks.length, before + 1)
    stopAll()

    // A free port: no question at all.
    await new Promise((resolve) => server.close(resolve))
    state.messages.length = 0
    await run(idOf('apps/docs', 'serve'))
    assert.strictEqual(state.messages.length, 0, JSON.stringify(state.messages))
    assert.strictEqual(state.executedTasks.length, before + 2)
    stopAll()
    await reconfigure({ checkPorts: false, scriptPorts: {} })
  })

  await test('"Stop it and run" frees the port and starts the script', async () => {
    const child = spawn(process.execPath, [
      '-e',
      "const s=require('net').createServer().listen(0,'127.0.0.1',()=>console.log(s.address().port))",
    ])
    const port = await new Promise((resolve) => child.stdout.once('data', (data) => resolve(Number(String(data).trim()))))
    try {
      if (!(await ports.findOwner(port))) return skip('stopping the program on a port', 'no tool here to find the owner of a port')
      await reconfigure({ checkPorts: true, scriptPorts: { serve: port } })
      const before = state.executedTasks.length
      state.messages.length = 0
      state.answers.push((buttons) => buttons[0])
      await run(idOf('apps/docs', 'serve'))
      assert.ok(/^Stop .+ and run$/.test(state.messages[0].buttons[0]), JSON.stringify(state.messages[0]))
      assert.ok(state.messages[0].detail.includes(`process ${child.pid}`), state.messages[0].detail)
      assert.strictEqual(state.executedTasks.length, before + 1)
      assert.strictEqual(await ports.isPortBusy(port), false)
      stopAll()
    } finally {
      child.kill()
      await reconfigure({ checkPorts: false, scriptPorts: {} })
    }
  })

  await test('a failed script turns its buttons red and offers "Run again"; a stopped one does not', async () => {
    const projectButton = () => state.statusItems.find((item) => item.text.endsWith(' docs'))
    const fail = (exitCode) => {
      const execution = state.taskExecutions[state.taskExecutions.length - 1]
      vscode.tasks.onDidEndTaskProcess.fire({ execution, exitCode })
      execution.terminate()
    }

    await run(idOf('apps/docs', 'serve'))
    const before = state.executedTasks.length
    state.messages.length = 0
    state.answers.push((buttons) => buttons.find((label) => label === 'Run again'))
    fail(3)
    await settle()
    assert.strictEqual(state.messages[0].message, "RunMate: 'serve (docs)' failed (exit code 3).")
    assert.deepStrictEqual(state.messages[0].buttons, ['Run again', 'Show terminal'])
    assert.strictEqual(state.executedTasks.length, before + 1, '"Run again" started it')
    assert.strictEqual(projectButton().text, '$(sync~spin) docs', 'running again, so no longer marked')

    // Fails again, this time the message is dismissed.
    fail(1)
    await settle()
    assert.strictEqual(projectButton().text, '$(error) docs')
    assert.strictEqual(projectButton().backgroundColor.id, 'statusBarItem.errorBackground')
    const qp = await openPicker(dirOf('apps/docs'))
    assert.strictEqual(qp.items[0].label, '$(error) serve')
    assert.ok(qp.items[0].description.startsWith('failed, exit code 1'), qp.items[0].description)
    qp.hide()

    // Stopped by the user (stop button, or Ctrl+C in the terminal): not a failure.
    for (const stop of ['button', 'ctrl+c']) {
      await run(idOf('apps/docs', 'serve'))
      assert.strictEqual(projectButton().text, '$(sync~spin) docs')
      state.messages.length = 0
      if (stop === 'button') {
        const execution = state.taskExecutions[state.taskExecutions.length - 1]
        await vscode.commands.executeCommand('run-mate-script-runner.stopScript', idOf('apps/docs', 'serve'))
        vscode.tasks.onDidEndTaskProcess.fire({ execution, exitCode: 1 })
      } else {
        fail(130)
      }
      await settle()
      assert.strictEqual(projectButton().text, '$(package) docs', stop)
      assert.strictEqual(state.messages.length, 0, stop)
    }

    // The message can be switched off; the red button stays.
    await reconfigure({ notifyOnFailure: false })
    await run(idOf('apps/docs', 'serve'))
    state.messages.length = 0
    fail(2)
    assert.strictEqual(state.messages.length, 0)
    assert.strictEqual(projectButton().text, '$(error) docs')
    await reconfigure({ notifyOnFailure: true })
    await run(idOf('apps/docs', 'serve'))
    stopAll()
  })

  await test('an env file chosen for a script is loaded, remembered and shown; a missing one stops the run', async () => {
    fs.writeFileSync(path.join(dirOf('apps/docs'), '.env.staging'), 'API_URL="https://staging.example"\nPORT=4010 # the port\n')
    fs.writeFileSync(path.join(dirOf('apps/docs'), '.env.example'), 'API_URL=\n')
    fs.writeFileSync(path.join(repo, '.env'), 'ROOT=1\n')

    let qp = await openPicker(dirOf('apps/docs'))
    let offered
    state.answers.push(
      (items) => items.find((item) => item.id === 'env'),
      (items) => {
        offered = items.map((item) => item.file)
        return items.find((item) => item.file === '.env.staging')
      }
    )
    await press(qp, 'serve', 'options')
    await settle()
    assert.deepStrictEqual(offered, ['', '.env.staging', '../../.env'], 'the example file is not offered')
    assert.deepStrictEqual(lastTask().execution.options.env, { API_URL: 'https://staging.example', PORT: '4010' })
    assert.strictEqual(lastTask().name, 'serve [.env.staging] (docs)')
    stopAll()

    // Remembered: a plain run uses it too, and the row says so.
    await run(idOf('apps/docs', 'serve'))
    assert.strictEqual(lastTask().execution.options.env.PORT, '4010')
    stopAll()
    qp = await openPicker(dirOf('apps/docs'))
    assert.ok(qp.items[0].description.startsWith('env: .env.staging'), qp.items[0].description)
    qp.hide()

    // The file disappears: RunMate says so instead of running without it.
    fs.rmSync(path.join(dirOf('apps/docs'), '.env.staging'))
    const before = state.executedTasks.length
    state.messages.length = 0
    await run(idOf('apps/docs', 'serve'))
    assert.strictEqual(state.executedTasks.length, before)
    assert.ok(state.messages[0].message.includes('".env.staging", but that file is not in docs'), state.messages[0].message)

    // "No env file" clears the choice.
    qp = await openPicker(dirOf('apps/docs'))
    state.answers.push(
      (items) => items.find((item) => item.id === 'env'),
      (items) => items.find((item) => item.file === '')
    )
    await press(qp, 'serve', 'options')
    await settle()
    assert.strictEqual(lastTask().execution.options.env, undefined)
    assert.strictEqual(lastTask().name, 'serve (docs)')
    stopAll()
  })

  await test('the "envFile" setting applies to every project that has that file', async () => {
    await reconfigure({ envFile: '.env' })
    await run(idOf('', 'dev'))
    assert.deepStrictEqual(lastTask().execution.options.env, { ROOT: '1' })
    stopAll()
    await run(idOf('apps/docs', 'serve')) // has no .env of its own
    assert.strictEqual(lastTask().execution.options.env, undefined)
    stopAll()
    await reconfigure({ envFile: '' })
    fs.rmSync(path.join(repo, '.env'))
  })

  await test('groups from settings get a button; a personal group can be shared, changed and deleted there', async () => {
    await reconfigure({
      groups: [
        { name: 'team dev', scripts: ['dev', { path: './apps/api/', script: 'dev' }, { path: 'gone', script: 'x' }] },
        { name: 'broken' },
      ],
    })
    assert.strictEqual(texts()[0], '$(run-all) team dev')
    const button = state.statusItems[0]
    const before = state.executedTasks.length
    await vscode.commands.executeCommand(button.command.command, ...button.command.arguments)
    assert.deepStrictEqual(state.executedTasks.slice(before).map((task) => task.name).sort(), ['dev', 'dev (api)'])
    stopAll()

    // A personal group, then "share with the team".
    state.answers.push((items) => items.filter((item) => /^(web|infra) /.test(item.description) && /^(dev|just up)$/.test(item.label)), 'mine')
    await vscode.commands.executeCommand('run-mate-script-runner.newGroup')
    let qp = await openPicker()
    assert.deepStrictEqual(labels(qp).slice(0, 3), ['--- Groups', '$(run-all) team dev', '$(run-all) mine'])
    assert.ok(qp.items[1].description.startsWith('shared in settings - '), qp.items[1].description)
    await press(qp, 'mine', 'shareGroup')
    assert.deepStrictEqual(state.settings.groups[2], {
      name: 'mine',
      // In list order: "infra" is one folder deep, "apps/web" two.
      scripts: [
        { path: 'infra', script: 'just:up' },
        { path: 'apps/web', script: 'dev' },
      ],
    })
    assert.strictEqual(context.workspaceState.get('run-mate.groups').length, 0, 'no longer a personal group')
    qp.hide()
    await settle()
    assert.ok(texts().includes('$(run-all) mine'))

    // Deleting a shared group removes it from settings.
    qp = await openPicker()
    await press(qp, 'mine', 'deleteGroup')
    qp.hide()
    assert.deepStrictEqual(state.settings.groups.map((group) => group.name), ['team dev', 'broken'])
    await reconfigure({ groups: [] })
    assert.ok(!texts().some((text) => text.includes('team dev')))
  })
}

main()

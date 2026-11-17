/**
 * Starts a separate, throwaway VS Code instance (own profile, no other
 * extensions) and runs test/host/index.js inside it: `npm run test:host`.
 *
 * Set VSCODE_EXE when VS Code is not in its default install location.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

function findCode() {
  const candidates = [
    process.env.VSCODE_EXE,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    '/usr/share/code/code',
    '/usr/bin/code',
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate))
}

const code = findCode()
if (!code) {
  console.error('VS Code not found. Set VSCODE_EXE to its executable.')
  process.exit(2)
}

// The space in the folder name is deliberate.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run mate host-'))
const workspace = path.join(base, 'work space')
const write = (rel, content) => {
  const file = path.join(workspace, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}
write('package.json', { name: 'root', scripts: { dev: 'node -v' } })
write('node_modules/.keep', '')
write('apps/web/package.json', {
  name: 'web',
  scripts: { mark: 'node mark.js', boom: 'node -e "process.exit(7)"', envmark: 'node envmark.js' },
})
write('apps/web/.env.test', 'RUNMATE_VAR="from env file"\n')
write(
  'apps/web/envmark.js',
  "require('fs').writeFileSync(require('path').join(__dirname, '..', '..', 'env.marker'), String(process.env.RUNMATE_VAR))\n"
)
write('apps/web/mark.js', "require('fs').writeFileSync(require('path').join(__dirname, '..', '..', 'web.marker'), 'ok')\n")

const resultFile = path.join(base, 'result.json')
const extensionRoot = path.resolve(__dirname, '..', '..')

const run = spawnSync(
  code,
  [
    workspace,
    `--extensionDevelopmentPath=${extensionRoot}`,
    `--extensionTestsPath=${path.join(__dirname, 'index.js')}`,
    `--user-data-dir=${path.join(base, 'user-data')}`,
    `--extensions-dir=${path.join(base, 'extensions')}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--new-window',
    // Needed when VS Code runs as root in a container.
    ...(process.platform === 'linux' && process.getuid && process.getuid() === 0 ? ['--no-sandbox', '--disable-gpu'] : []),
  ],
  { env: { ...process.env, RUNMATE_HOST_RESULT: resultFile }, encoding: 'utf8', timeout: 300000 }
)

if (!fs.existsSync(resultFile)) {
  console.error('VS Code did not produce a result file.')
  console.error(run.stderr || run.error || `exit ${run.status}`)
  process.exit(1)
}

const results = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
for (const result of results) {
  console.log(`${result.ok ? '  ok  ' : '  FAIL'}  ${result.name}`)
  if (result.info) console.log(`          ${result.info.split('\n').join('\n          ')}`)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
try {
  fs.rmSync(base, { recursive: true, force: true })
} catch {}
process.exit(failed ? 1 : 0)

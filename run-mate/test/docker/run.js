/**
 * Runs every RunMate test on Linux in a throwaway Docker container:
 * `npm run test:linux`.
 *
 *  1. test/run.js     logic + generated commands in bash, zsh, fish, sh
 *  2. test/switch.js  real Node installs and switches with nvm, fnm, Volta
 *  3. test/host       the extension inside a real VS Code (virtual display)
 *
 * The source folder is mounted read-only and copied inside the container.
 */
const path = require('path')
const { spawnSync } = require('child_process')

const IMAGE = 'runmate-test'
const root = path.resolve(__dirname, '..', '..')

function docker(args) {
  const result = spawnSync('docker', args, { stdio: 'inherit' })
  if (result.error) {
    console.error('Docker is not available:', result.error.message)
    process.exit(2)
  }
  return result.status
}

if (docker(['build', '-q', '-t', IMAGE, __dirname]) !== 0) process.exit(1)

const script = [
  'mkdir -p /work/rm',
  'cd /src && cp -r package.json extension.js src test walkthrough node_modules /work/rm/',
  'cd /work/rm',
  'status=0',
  'echo "=== logic and shells"; node test/run.js || status=1',
  'echo "=== real Node switching"; RUNMATE_ALLOW_INSTALL=1 node test/switch.js || status=1',
  'echo "=== inside VS Code"; xvfb-run -a node test/host/launch.js || status=1',
  'exit $status',
].join('\n')

process.exit(docker(['run', '--rm', '-v', `${root}:/src:ro`, IMAGE, 'bash', '-c', script]))

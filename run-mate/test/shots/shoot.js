/**
 * Takes the README pictures from a real, throwaway VS Code window with the
 * extension loaded from source. Run it again when the UI changes:
 *
 *   npm install --no-save playwright-core gifenc pngjs
 *   npm run shots
 *
 * (Windows only as written: it looks for Code.exe in the default place.)
 *
 *   node shoot.js <extension folder> <output folder> [stills|gif]
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { _electron: electron } = require('playwright-core')

const [extensionArg, outArg, mode = 'stills'] = process.argv.slice(2)
const extensionRoot = path.resolve(extensionArg)
const outDir = path.resolve(outArg)
const code = path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
const SCALE = mode === 'gif' ? 1 : 1.5
const SIZE = mode === 'gif' ? [960, 600] : [1200, 760]

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'runmate-shots-'))
const workspace = path.join(base, 'shop')
const write = (root, rel, content) => {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}
const SERVER =
  "const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 3000\n" +
  "require('http').createServer((q, s) => s.end('ok')).listen(port, () => console.log('ready on http://localhost:' + port))\n"

write(workspace, 'package.json', {
  name: 'shop',
  private: true,
  workspaces: ['apps/*'],
  scripts: { dev: 'node tools/watch.js', build: 'node tools/ok.js build', lint: 'node tools/fail.js', format: 'node tools/ok.js format' },
})
write(workspace, 'package-lock.json', '{}')
write(workspace, 'tools/ok.js', "console.log('done:', process.argv.slice(2).join(' '))\n")
write(workspace, 'tools/watch.js', 'setInterval(() => {}, 1000)\nconsole.log("watching for changes...")\n')
write(workspace, 'tools/fail.js', "console.error('src/cart.ts 12:5  error  Unexpected any')\nprocess.exit(1)\n")
write(workspace, 'Makefile', 'deploy:\n\t@echo deploying\n')
write(workspace, 'apps/web/package.json', {
  name: 'web',
  scripts: {
    dev: 'node server.js --port 4173',
    build: 'node ../../tools/ok.js build web',
    preview: 'node ../../tools/ok.js preview',
    storybook: 'node ../../tools/ok.js storybook',
    typecheck: 'node ../../tools/ok.js tsc',
  },
})
write(workspace, 'apps/web/server.js', SERVER)
write(workspace, 'apps/web/.env.local', 'API_URL=http://localhost:4000\n')
write(workspace, 'apps/web/.env.staging', 'API_URL=https://staging.example.com\n')
write(workspace, 'apps/api/package.json', {
  name: 'api',
  scripts: { dev: 'node server.js --port 4000', migrate: 'node ../../tools/ok.js migrate', seed: 'node ../../tools/ok.js seed' },
})
write(workspace, 'apps/api/server.js', SERVER)
const GROUPS = {
  'run-mate-script-runner.groups': [
    { name: 'dev all', scripts: [{ path: 'apps/web', script: 'dev' }, { path: 'apps/api', script: 'dev' }] },
  ],
}
const workspaceSettings = (extra = {}) => write(workspace, '.vscode/settings.json', { ...GROUPS, ...extra })
workspaceSettings()

const userData = path.join(base, 'user-data')
write(userData, 'User/settings.json', {
  'workbench.startupEditor': 'none',
  'workbench.colorTheme': 'Default Dark Modern',
  'window.dialogStyle': 'custom',
  'window.titleBarStyle': 'custom',
  'window.commandCenter': false,
  'workbench.layoutControl.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'chat.commandCenter.enabled': false,
  'workbench.tips.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.ignoreRecommendations': true,
  'security.workspace.trust.enabled': false,
  'git.enabled': false,
  'editor.minimap.enabled': false,
  'terminal.integrated.defaultProfile.windows': 'PowerShell',
  'run-mate-script-runner.preflightChecks': false,
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const app = await electron.launch({
    executablePath: code,
    args: [
      workspace,
      path.join(workspace, 'package.json'),
      `--extensionDevelopmentPath=${extensionRoot}`,
      `--user-data-dir=${userData}`,
      `--extensions-dir=${path.join(base, 'extensions')}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--new-window',
      `--force-device-scale-factor=${SCALE}`,
    ],
  })
  const page = await app.firstWindow()
  const win = await app.browserWindow(page)
  await win.evaluate((w, [width, height]) => {
    w.unmaximize()
    w.setContentSize(width, height)
    w.center()
  }, SIZE)
  await page.waitForSelector('.statusbar')
  await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent.includes('dev all'), null, {
    timeout: 60000,
  })
  await sleep(2500)

  const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  console.log('window', size)
  const shot = (name, clip) => page.screenshot({ path: path.join(outDir, name), ...(clip ? { clip } : {}) })
  const strip = (name, width = 560, height = 34) => shot(name, { x: 0, y: size.h - height, width, height })
  const quick = page.locator('.quick-input-widget')
  const box = async (locator, pad = 10) => {
    const b = await locator.boundingBox()
    const x = Math.max(0, b.x - pad)
    const y = Math.max(0, b.y - pad)
    return { x, y, width: Math.min(size.w - x, b.width + pad * 2), height: Math.min(size.h - y, b.height + pad * 2) }
  }
  const openList = async (filter) => {
    await page.keyboard.press('Control+Alt+Q')
    await quick.waitFor({ state: 'visible' })
    await sleep(500)
    if (filter) {
      await page.keyboard.type(filter, { delay: mode === 'gif' ? 90 : 0 })
      await sleep(500)
    }
  }
  const row = (text) => quick.locator('.monaco-list-row', { hasText: text }).first()

  // The side bar adds nothing to these pictures.
  await page.keyboard.press('Control+B')
  await sleep(600)

  if (mode === 'gif') return recordGif(app, page, size, openList)

  // 1. One button per project, plus a shared group.
  await strip('statusbar-projects.png')

  // 2. The script list with the buttons of a row.
  await openList()
  await row('node tools/ok.js build').hover()
  await sleep(500)
  await shot('script-list.png', await box(quick))

  // 3. Run with options.
  await row('node server.js --port 4173').hover()
  await sleep(300)
  await row('node server.js --port 4173').locator('.codicon-terminal').click()
  await sleep(800)
  await shot('run-options.png', await box(quick))

  // 4. Choosing an env file.
  await page.keyboard.type('env file')
  await sleep(400)
  await page.keyboard.press('Enter')
  await sleep(800)
  await shot('env-file.png', await box(quick))
  await page.keyboard.press('Escape')
  await sleep(500)

  // 5. The port of a dev server is taken.
  const blocker = net.createServer().listen(4173, '127.0.0.1')
  await sleep(300)
  await openList('port 4173')
  await page.keyboard.press('Enter')
  const dialog = page.locator('.monaco-dialog-box')
  await dialog.waitFor({ state: 'visible', timeout: 20000 })
  await sleep(500)
  await shot('port-in-use.png', await box(dialog, 16))
  await page.keyboard.press('Escape')
  await new Promise((resolve) => blocker.close(resolve))
  await sleep(500)

  // 6. Script buttons: one running, one failed, with the message.
  workspaceSettings({ 'run-mate-script-runner.statusBarLayout': 'scripts', 'run-mate-script-runner.nestedProjects': false })
  await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent.includes('format'), null, { timeout: 20000 })
  await sleep(800)
  await openList('tools/watch')
  await page.keyboard.press('Enter')
  await sleep(2500)
  await openList('tools/fail')
  await page.keyboard.press('Enter')
  const toast = page.locator('.notification-toast', { hasText: 'failed' }).first()
  await toast.waitFor({ state: 'visible', timeout: 20000 })
  await sleep(700)
  await strip('statusbar-scripts.png')
  await shot('script-failed.png', await box(toast, 10))
  await shot('window.png')

  await app.close()
}

/** A short clip: open the list, pick the group, watch both servers start. */
async function recordGif(app, page, size, openList) {
  const { GIFEncoder, quantize, applyPalette } = require('gifenc')
  const { PNG } = require('pngjs')
  const frames = []
  let recording = true
  const loop = (async () => {
    while (recording) {
      const started = Date.now()
      frames.push({ at: started, png: await page.screenshot() })
      await sleep(Math.max(0, 180 - (Date.now() - started)))
    }
  })()

  await sleep(900)
  await openList()
  await sleep(1100)
  await page.keyboard.type('dev all', { delay: 110 })
  await sleep(900)
  await page.keyboard.press('Enter')
  await sleep(4500)
  // Stop everything again with the group's button.
  await page.locator('.statusbar-item', { hasText: 'dev all' }).first().click()
  await sleep(2200)
  recording = false
  await loop

  const gif = GIFEncoder()
  frames.forEach((frame, index) => {
    const { data, width, height } = PNG.sync.read(frame.png)
    const next = frames[index + 1]
    const delay = next ? next.at - frame.at : 1500
    const palette = quantize(data, 256)
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay })
  })
  gif.finish()
  fs.writeFileSync(path.join(outDir, 'demo.gif'), Buffer.from(gif.bytes()))
  console.log('frames', frames.length)
  await app.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

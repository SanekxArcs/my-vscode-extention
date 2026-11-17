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
const { execSync } = require('child_process')
const { _electron: electron } = require('playwright-core')

const [extensionArg, outArg, mode = 'stills'] = process.argv.slice(2)
const extensionRoot = path.resolve(extensionArg)
const outDir = path.resolve(outArg)
const code = path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
const SCALE = mode === 'gif' ? 1 : 1.5
const SIZE = mode === 'gif' ? [960, 600] : [1200, 760]

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'terminalmate-shots-'))
const workspace = path.join(base, 'shop')
const write = (root, rel, content) => {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}

write(workspace, 'package.json', { name: 'shop', private: true })
write(workspace, 'tools/build.js', "console.log('build finished in 1.2s')\n")
write(workspace, 'tools/deploy.js', "console.log('deployed to ' + process.argv[2])\n")
// A real repository, so the git commands in the pictures really work.
const git = (args) => execSync(`git ${args}`, { cwd: workspace, stdio: 'ignore' })
git('init -b main')
git('add .')
git('-c user.name=shots -c user.email=shots@example.com commit -m init')

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
  'terminal-mate.customTerminals': [
    { title: 'Install', command: 'npm install' },
    { title: 'Kill port', command: 'npx kill-port ${input:Port}' },
    { title: 'New branch', command: 'git switch -c ${input:Branch name}', group: 'git' },
    { title: 'Commit', command: 'git commit -m ${input:Message}', group: 'git' },
    { title: 'Update from main', command: 'git pull --rebase origin main', group: 'git' },
    { title: 'Reset everything', command: 'git reset --hard && git clean -fd', group: 'git' },
    { title: 'Build', command: 'node tools/build.js', group: 'deploy' },
    { title: 'Deploy', command: 'node tools/deploy.js ${pick:Where|staging|production}', group: 'deploy' },
    { title: 'Build and deploy', chain: ['Build', 'Deploy'], group: 'deploy' },
    { title: 'Old deploy script', command: 'sh deploy-old.sh', archived: true },
  ],
})
write(userData, 'User/keybindings.json', [
  { key: 'ctrl+alt+m', command: 'terminal-mate.openCommands' },
  { key: 'ctrl+alt+h', command: 'terminal-mate.scheduledCommands' },
])

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
  await page.waitForFunction(() => document.querySelector('.statusbar')?.textContent.includes('TM'), null, {
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
  const typing = { delay: mode === 'gif' ? 100 : 0 }
  const openList = async (filter) => {
    await page.keyboard.press('Control+Alt+M')
    await quick.waitFor({ state: 'visible' })
    await sleep(500)
    if (filter) {
      await page.keyboard.type(filter, typing)
      await sleep(500)
    }
  }
  const row = (text) => quick.locator('.monaco-list-row', { hasText: text }).first()

  // The side bar adds nothing to these pictures.
  await page.keyboard.press('Control+B')
  await sleep(600)

  if (mode === 'gif') return recordGif(app, page, openList)

  // 1. The list, with the buttons of a row.
  await openList()
  await row('git commit -m').hover()
  await sleep(500)
  await shot('command-list.png', await box(quick))

  // 2. The edit menu.
  await row('git commit -m').locator('.codicon-edit').click()
  await sleep(800)
  await shot('edit-menu.png', await box(quick))
  await page.keyboard.press('Escape')
  await sleep(500)

  // 3. A command that asks a question.
  await openList('New branch')
  await page.keyboard.press('Enter')
  await sleep(800)
  await page.keyboard.type('feature/login')
  await sleep(400)
  await shot('ask-input.png', await box(quick))
  await page.keyboard.press('Enter')
  await sleep(4000)

  // 4. A risky command asks first.
  await openList('Reset everything')
  await page.keyboard.press('Enter')
  await sleep(800)
  await shot('dangerous.png', await box(quick))
  await page.keyboard.press('Escape')
  await sleep(500)

  // 5. Scheduling.
  await openList()
  await row('node tools/build.js').hover()
  await sleep(300)
  await row('node tools/build.js').locator('.codicon-clock').click()
  await sleep(800)
  await page.keyboard.type('every 15m')
  await sleep(400)
  await shot('schedule.png', await box(quick))
  await page.keyboard.press('Enter')
  await sleep(1500)

  // 6. A chain; it also becomes the "Last:" button.
  await openList('Build and deploy')
  await page.keyboard.press('Enter')
  await sleep(800)
  await page.keyboard.press('Enter') // staging
  await sleep(6000)
  await page.keyboard.press('Control+Shift+P')
  await sleep(500)
  await page.keyboard.type('Notifications: Clear All Notifications')
  await sleep(500)
  await page.keyboard.press('Enter')
  await sleep(800)
  await strip('statusbar.png', 620)
  await shot('window.png')

  // 7. The list of schedules.
  await page.keyboard.press('Control+Alt+H')
  await quick.waitFor({ state: 'visible' })
  await sleep(600)
  await shot('scheduled.png', await box(quick))
  await page.keyboard.press('Escape')

  await app.close()
}

/** A short clip: a command that asks a question, then a chain. */
async function recordGif(app, page, openList) {
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
  await sleep(1300)
  await page.keyboard.type('new br', { delay: 110 })
  await sleep(800)
  await page.keyboard.press('Enter')
  await sleep(900)
  await page.keyboard.type('feature/login', { delay: 90 })
  await sleep(700)
  await page.keyboard.press('Enter')
  await sleep(4500)

  await openList()
  await sleep(700)
  await page.keyboard.type('build and', { delay: 110 })
  await sleep(800)
  await page.keyboard.press('Enter')
  await sleep(1200)
  await page.keyboard.press('Enter') // staging
  await sleep(6000)
  recording = false
  await loop

  const gif = GIFEncoder()
  frames.forEach((frame, index) => {
    const { data, width, height } = PNG.sync.read(frame.png)
    const next = frames[index + 1]
    const delay = next ? next.at - frame.at : 2000
    const palette = quantize(data, 256)
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay })
  })
  gif.finish()
  fs.writeFileSync(path.join(outDir, 'demo.gif'), Buffer.from(gif.bytes()))
  if (process.env.SHOTS_DEBUG) fs.writeFileSync(path.join(process.env.SHOTS_DEBUG, 'last-frame.png'), frames[frames.length - 1].png)
  console.log('frames', frames.length)
  await app.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

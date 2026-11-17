const fs = require('fs')
const path = require('path')

/** `.env`, `.env.local`, `.env.staging`, ... but not the templates people commit as examples. */
const ENV_FILE = /^\.env(\.[\w.-]+)?$/
const TEMPLATE = /\.(example|sample|template|dist|defaults)$/i

const LINE =
  /^[ \t]*(?:export[ \t]+)?([A-Za-z_][\w.-]*)[ \t]*=[ \t]*('[^']*'|"(?:\\[\s\S]|[^"\\])*"|`[^`]*`|[^#\r\n]*)[ \t]*(?:#.*)?$/gm

/**
 * Reads the text of an env file into an object. Supports comments,
 * `export KEY=value`, single, double and backtick quotes (which may span
 * lines), and `\n` inside double quotes. Variables are not expanded.
 */
function parseEnv(text) {
  const env = {}
  LINE.lastIndex = 0
  let match
  while ((match = LINE.exec(text))) {
    let value = match[2].trim()
    const quote = value[0]
    if (value.length >= 2 && (quote === '"' || quote === "'" || quote === '`') && value.endsWith(quote)) {
      value = value.slice(1, -1)
      if (quote === '"') {
        value = value.replace(/\\([nrt"\\])/g, (_, ch) => ({ n: '\n', r: '\r', t: '\t' })[ch] ?? ch)
      }
    }
    env[match[1]] = value
  }
  return env
}

async function envFilesIn(dir) {
  try {
    const names = await fs.promises.readdir(dir)
    return names.filter((name) => ENV_FILE.test(name) && !TEMPLATE.test(name)).sort()
  } catch {
    return []
  }
}

/**
 * Env files a script of this project can run with: the ones in its own
 * folder, then the ones in the workspace folder above it. Paths are
 * relative to the project folder (`.env.local`, `../../.env`).
 */
async function listEnvFiles(project) {
  const files = await envFilesIn(project.dir)
  const root = project.folder.uri.fsPath
  if (path.resolve(root) !== path.resolve(project.dir)) {
    const up = path.relative(project.dir, root).split(path.sep).join('/')
    for (const name of await envFilesIn(root)) files.push(`${up}/${name}`)
  }
  return files
}

/** Reads one env file of a project. Returns its variables, or null when the file is missing. */
async function loadEnvFile(project, relative) {
  try {
    return parseEnv(await fs.promises.readFile(path.resolve(project.dir, relative), 'utf8'))
  } catch {
    return null
  }
}

module.exports = { parseEnv, listEnvFiles, loadEnvFile }

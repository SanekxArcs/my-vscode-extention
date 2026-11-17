const { parse } = require('jsonc-parser')

/**
 * Where runnable things come from, besides package.json scripts. Each parser
 * takes the text of a file and returns `[{ name, command }]`. No vscode.
 */

/** File names per source, in the order they are looked for. */
const SOURCE_FILES = {
  npm: ['package.json'],
  deno: ['deno.json', 'deno.jsonc'],
  make: ['Makefile', 'makefile', 'GNUmakefile'],
  just: ['justfile', 'Justfile', '.justfile'],
}

const SOURCE_LABELS = { npm: 'package.json scripts', deno: 'Deno tasks', make: 'Makefile targets', just: 'just recipes' }

function parseJsonObject(text) {
  try {
    const value = parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** package.json: the "scripts" object. */
function parseNpmScripts(text) {
  const pkg = parseJsonObject(text)
  if (!pkg || typeof pkg.scripts !== 'object' || pkg.scripts === null) return []
  return Object.entries(pkg.scripts)
    .filter(([, command]) => typeof command === 'string')
    .map(([name, command]) => ({ name, command }))
}

/** deno.json: the "tasks" object. A task is a string or `{ command }`. */
function parseDenoTasks(text) {
  const config = parseJsonObject(text)
  if (!config || typeof config.tasks !== 'object' || config.tasks === null) return []
  const tasks = []
  for (const [name, value] of Object.entries(config.tasks)) {
    const command = typeof value === 'string' ? value : value && typeof value.command === 'string' ? value.command : null
    if (command !== null) tasks.push({ name, command })
  }
  return tasks
}

/**
 * Makefile: targets a person would run. Skipped: special targets (.PHONY),
 * pattern rules (%.o), file paths (dist/app.js) and variable assignments.
 */
function parseMakeTargets(text) {
  const lines = String(text).split(/\r?\n/)
  const targets = []
  const seen = new Set()
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_][A-Za-z0-9_.-]*(?:[ \t]+[A-Za-z0-9_][A-Za-z0-9_.-]*)*)[ \t]*:(?![:=])/.exec(lines[i])
    if (!m) continue
    const recipe = lines[i + 1] && /^\t/.test(lines[i + 1]) ? lines[i + 1].trim().replace(/^[@-]+/, '') : ''
    for (const name of m[1].split(/[ \t]+/)) {
      if (seen.has(name)) continue
      seen.add(name)
      targets.push({ name, command: recipe || `make ${name}` })
    }
  }
  return targets
}

/** justfile: recipes. Skipped: private recipes (starting with "_") and settings. */
function parseJustRecipes(text) {
  const lines = String(text).split(/\r?\n/)
  const recipes = []
  const seen = new Set()
  for (let i = 0; i < lines.length; i++) {
    const m = /^@?([A-Za-z][A-Za-z0-9_-]*)((?:[ \t]+[^:=\s][^:]*)?)[ \t]*:(?!=)/.exec(lines[i])
    if (!m) continue
    const name = m[1]
    if (['set', 'alias', 'export', 'import', 'mod'].includes(name) && m[2].trim()) continue
    if (seen.has(name)) continue
    seen.add(name)
    const body = lines[i + 1] && /^[ \t]+\S/.test(lines[i + 1]) ? lines[i + 1].trim().replace(/^[@-]+/, '') : ''
    recipes.push({ name, command: body || `just ${name}` })
  }
  return recipes
}

const PARSERS = { npm: parseNpmScripts, deno: parseDenoTasks, make: parseMakeTargets, just: parseJustRecipes }

/** The `packages:` list of a pnpm-workspace.yaml (block or inline form). */
function parsePnpmWorkspace(text) {
  const lines = String(text).split(/\r?\n/)
  const start = lines.findIndex((line) => /^packages\s*:/.test(line))
  if (start === -1) return []
  const unquote = (value) => value.trim().replace(/^['"]|['"]$/g, '')

  const inline = /^packages\s*:\s*\[(.*)\]\s*$/.exec(lines[start])
  if (inline) return inline[1].split(',').map(unquote).filter(Boolean)

  const globs = []
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue
    const item = /^\s+-\s+(.*?)\s*(#.*)?$/.exec(line)
    if (!item) break
    globs.push(unquote(item[1]))
  }
  return globs.filter(Boolean)
}

/**
 * Folders a monorepo declares as its packages: `workspaces` in package.json
 * (npm, Yarn, Bun) and `packages` in pnpm-workspace.yaml. Exclusions ("!x")
 * are dropped; the ignored-folder list covers the usual cases.
 */
function parseWorkspaceGlobs(packageJsonText, pnpmWorkspaceText) {
  const globs = []
  const pkg = packageJsonText ? parseJsonObject(packageJsonText) : null
  const declared = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages
  if (Array.isArray(declared)) globs.push(...declared.filter((glob) => typeof glob === 'string'))
  if (pnpmWorkspaceText) globs.push(...parsePnpmWorkspace(pnpmWorkspaceText))
  return [...new Set(globs.map((glob) => glob.replace(/^\.\//, '').replace(/\/+$/, '')))].filter(
    (glob) => glob && !glob.startsWith('!') && !glob.startsWith('..') && !glob.startsWith('/')
  )
}

module.exports = {
  SOURCE_FILES,
  SOURCE_LABELS,
  PARSERS,
  parseNpmScripts,
  parseDenoTasks,
  parseMakeTargets,
  parseJustRecipes,
  parsePnpmWorkspace,
  parseWorkspaceGlobs,
}

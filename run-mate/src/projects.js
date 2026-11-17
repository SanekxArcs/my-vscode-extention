const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { readText } = require('./packageUtils')
const { SOURCE_FILES, PARSERS, parseWorkspaceGlobs } = require('./sources')

const DEFAULT_IGNORED = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '.vercel',
  '.venv',
]

const ALL_SOURCES = ['npm', 'deno', 'make', 'just']
const MAX_FILES = 400

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/** Reads every enabled source in one folder and returns its entries (without a project yet). */
async function readFolderScripts(dir, sources, exclude) {
  let names
  try {
    names = new Set(await fs.promises.readdir(dir))
  } catch {
    return []
  }

  const scripts = []
  for (const kind of sources) {
    const file = SOURCE_FILES[kind].find((name) => names.has(name))
    if (!file) continue
    const text = await readText(path.join(dir, file))
    if (text === null) continue
    for (const item of PARSERS[kind](text)) {
      if (exclude.has(item.name)) continue
      scripts.push({ ...item, kind })
    }
  }
  return scripts
}

/**
 * Finds every project in the workspace. A project is a folder with something
 * to run: package.json scripts, Deno tasks, Makefile targets or just recipes.
 *
 * Besides the root of each workspace folder this looks at:
 *  - the packages a monorepo declares (`workspaces`, pnpm-workspace.yaml),
 *    however deep they are
 *  - other subfolders, down to `nestedProjectsMaxDepth`
 */
async function discoverProjects(cfg) {
  const allFolders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file')
  const folders = cfg.get('workspaceMode', 'first') === 'first' ? allFolders.slice(0, 1) : allFolders

  const nested = cfg.get('nestedProjects', true)
  const maxDepth = Math.max(1, Number(cfg.get('nestedProjectsMaxDepth', 3)) || 3)
  const ignored = cfg.get('nestedProjectsExclude', DEFAULT_IGNORED).filter((name) => /^[\w.@-]+$/.test(name))
  const exclude = new Set(cfg.get('excludeScripts', []))
  const sources = ALL_SOURCES.filter((kind) => cfg.get('scriptSources', ALL_SOURCES).includes(kind))
  const fileNames = sources.flatMap((kind) => SOURCE_FILES[kind])

  const projects = []
  for (const folder of folders) {
    const root = folder.uri.fsPath
    const depthOf = (dir) => {
      const rel = toPosix(path.relative(root, dir))
      return rel ? rel.split('/').length : 0
    }
    const dirs = new Set([root])

    if (nested && fileNames.length) {
      const excludeGlob = ignored.length ? `**/{${ignored.join(',')}}/**` : null
      const find = (pattern) => vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern), excludeGlob, MAX_FILES)

      for (const uri of await find(`**/{${fileNames.join(',')}}`)) {
        const dir = path.dirname(uri.fsPath)
        if (depthOf(dir) <= maxDepth) dirs.add(dir)
      }

      // Declared monorepo packages are exact, so they have no depth limit.
      const globs = parseWorkspaceGlobs(
        await readText(path.join(root, 'package.json')),
        await readText(path.join(root, 'pnpm-workspace.yaml'))
      )
      for (const glob of globs) {
        for (const uri of await find(`${glob}/package.json`)) dirs.add(path.dirname(uri.fsPath))
      }
    }

    const candidates = [...dirs]
      .map((dir) => ({ dir, relPath: toPosix(path.relative(root, dir)), depth: depthOf(dir) }))
      .sort((a, b) => a.depth - b.depth || a.relPath.localeCompare(b.relPath))

    for (const candidate of candidates) {
      const scripts = await readFolderScripts(candidate.dir, sources, exclude)
      if (!scripts.length) continue

      const project = {
        id: candidate.dir,
        // Root projects keep the key older versions used for favorites.
        key: candidate.relPath ? `${folder.name}/${candidate.relPath}` : folder.name,
        name: candidate.relPath ? path.basename(candidate.dir) : folder.name,
        relPath: candidate.relPath,
        dir: candidate.dir,
        folder,
      }
      project.entries = scripts.map((script) => {
        // `script` identifies the entry inside its project. package.json
        // scripts keep their plain name; others get a prefix ("make:build").
        const id = script.kind === 'npm' ? script.name : `${script.kind}:${script.name}`
        return {
          id: `${project.id}::${id}`,
          key: `${project.key}::${id}`,
          script: id,
          name: script.name,
          kind: script.kind,
          command: script.command,
          project,
        }
      })
      projects.push(project)
    }
  }

  // Two projects with the same folder name get a longer, unambiguous name.
  const counts = new Map()
  for (const project of projects) counts.set(project.name, (counts.get(project.name) || 0) + 1)
  for (const project of projects) {
    if (counts.get(project.name) > 1) project.name = project.relPath ? project.key : `${project.name} (root)`
  }

  return projects
}

/**
 * "pick" workspace mode: the same script in several projects becomes one
 * entry, and the project is chosen when it runs.
 */
function mergeByName(projects) {
  const byScript = new Map()
  for (const project of projects) {
    for (const entry of project.entries) {
      if (!byScript.has(entry.script)) byScript.set(entry.script, [])
      byScript.get(entry.script).push(entry)
    }
  }
  return [...byScript.entries()].map(([script, variants]) =>
    variants.length === 1
      ? variants[0]
      : {
          id: `*::${script}`,
          key: `::${script}`,
          script,
          name: variants[0].name,
          kind: variants[0].kind,
          command: variants[0].command,
          project: null,
          variants,
        }
  )
}

/** File names that can change the list of projects or scripts, for the watcher. */
function watchedGlob() {
  return `**/{${[...Object.values(SOURCE_FILES).flat(), 'pnpm-workspace.yaml'].join(',')}}`
}

module.exports = { discoverProjects, mergeByName, watchedGlob, DEFAULT_IGNORED, ALL_SOURCES }

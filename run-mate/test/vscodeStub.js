/**
 * A small stand-in for the `vscode` module, enough to load the extension in
 * plain Node and drive it: status bar items, quick picks, tasks, settings.
 */
const fs = require('fs')
const path = require('path')
const Module = require('module')

const manifest = require('../package.json')
const defaults = {}
for (const [key, schema] of Object.entries(manifest.contributes.configuration[0].properties)) {
  defaults[key.replace('run-mate-script-runner.', '')] = schema.default
}

function walk(dir, ignored, out, depth = 0) {
  if (depth > 8) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) walk(path.join(dir, entry.name), ignored, out, depth + 1)
    } else {
      out.push(path.join(dir, entry.name))
    }
  }
}

/** Enough of VS Code's glob syntax for the patterns RunMate uses. */
function globToRegExp(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?'
      i += 2
    } else if (glob.startsWith('**', i)) {
      source += '.*'
      i += 1
    } else if (ch === '*') {
      source += '[^/]*'
    } else if (ch === '{') {
      const end = glob.indexOf('}', i)
      source += `(?:${glob.slice(i + 1, end).split(',').map(escapeRegExp).join('|')})`
      i = end
    } else {
      source += escapeRegExp(ch)
    }
  }
  return new RegExp(`^${source}$`)
}

function escapeRegExp(text) {
  return text.replace(/[.+^$()|[\]\\]/g, (ch) => `\\${ch}`)
}

function createStub() {
  const state = {
    settings: { ...defaults },
    statusItems: [],
    quickPicks: [],
    commands: new Map(),
    executedTasks: [],
    taskExecutions: [],
    messages: [],
    /** Answers for modal questions and showQuickPick, consumed in order. */
    answers: [],
    listeners: { start: [], end: [], config: [] },
  }

  const emitter = () => {
    const handlers = []
    const event = (handler) => {
      handlers.push(handler)
      return { dispose() {} }
    }
    event.fire = (value) => handlers.forEach((handler) => handler(value))
    return event
  }

  const uri = (fsPath) => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` })
  const nextAnswer = (items) => {
    const answer = state.answers.shift()
    return typeof answer === 'function' ? answer(items) : answer
  }

  const vscode = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    TaskRevealKind: { Always: 1 },
    TaskPanelKind: { Dedicated: 2, New: 3 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    ThemeIcon: class {
      constructor(id) {
        this.id = id
      }
    },
    ThemeColor: class {
      constructor(id) {
        this.id = id
      }
    },
    RelativePattern: class {
      constructor(base, pattern) {
        this.base = base
        this.pattern = pattern
      }
    },
    ShellExecution: class {
      constructor(commandLine, options) {
        this.commandLine = commandLine
        this.options = options
      }
    },
    Task: class {
      constructor(definition, scope, name, source, execution) {
        Object.assign(this, { definition, scope, name, source, execution })
      }
    },
    Uri: { file: uri, parse: (value) => ({ toString: () => value }) },
    env: { shell: process.env.ComSpec || '/bin/sh', openExternal: async () => true },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (key, fallback) => (state.settings[key] !== undefined ? state.settings[key] : fallback),
        inspect: () => ({}),
        update: async (key, value) => {
          state.settings[key] = value
          vscode.workspace.onDidChangeConfiguration.fire({ affectsConfiguration: () => true })
        },
      }),
      findFiles: async (pattern, exclude) => {
        const ignored = new Set(
          exclude
            ? exclude
                .replace(/^\*\*\/\{/, '')
                .replace(/\}\/\*\*$/, '')
                .split(',')
            : []
        )
        const out = []
        const root = pattern.base.uri.fsPath
        walk(root, ignored, out)
        const matcher = globToRegExp(pattern.pattern)
        return out.filter((file) => matcher.test(path.relative(root, file).split(path.sep).join('/'))).map(uri)
      },
      createFileSystemWatcher: () => ({
        onDidChange() {},
        onDidCreate() {},
        onDidDelete() {},
        dispose() {},
      }),
      onDidChangeConfiguration: emitter(),
      onDidChangeWorkspaceFolders: emitter(),
    },
    window: {
      createStatusBarItem: (alignment, priority) => {
        const item = {
          alignment,
          priority,
          visible: false,
          show() {
            this.visible = true
          },
          dispose() {
            state.statusItems = state.statusItems.filter((other) => other !== item)
          },
        }
        state.statusItems.push(item)
        return item
      },
      createQuickPick: () => {
        const handlers = {}
        const on = (name) => (handler) => {
          handlers[name] = handler
          return { dispose() {} }
        }
        const qp = {
          items: [],
          buttons: [],
          selectedItems: [],
          activeItems: [],
          handlers,
          shown: false,
          onDidTriggerButton: on('button'),
          onDidTriggerItemButton: on('itemButton'),
          onDidAccept: on('accept'),
          onDidHide: on('hide'),
          show() {
            this.shown = true
          },
          hide() {
            this.shown = false
            if (handlers.hide) handlers.hide()
          },
          dispose() {},
        }
        state.quickPicks.push(qp)
        return qp
      },
      showQuickPick: async (items) => nextAnswer(items),
      showInputBox: async () => nextAnswer(),
      showWarningMessage: async (message, options, ...buttons) => {
        state.messages.push({ message, detail: options?.detail, buttons })
        return nextAnswer(buttons)
      },
      showInformationMessage: async (message) => {
        state.messages.push({ message })
      },
      // Only an error with buttons waits for an answer.
      showErrorMessage: async (message, ...buttons) => {
        state.messages.push({ message, error: true, buttons })
        return buttons.length ? nextAnswer(buttons) : undefined
      },
      terminals: [],
    },
    commands: {
      registerCommand: (id, handler) => {
        if (state.commands.has(id)) throw new Error(`command ${id} already exists`)
        state.commands.set(id, handler)
        return { dispose: () => state.commands.delete(id) }
      },
      executeCommand: async (id, ...args) => state.commands.get(id)?.(...args),
    },
    tasks: {
      get taskExecutions() {
        return state.taskExecutions
      },
      executeTask: async (task) => {
        const execution = {
          task,
          terminate() {
            state.taskExecutions = state.taskExecutions.filter((other) => other !== execution)
            vscode.tasks.onDidEndTask.fire({ execution })
          },
        }
        state.executedTasks.push(task)
        state.taskExecutions.push(execution)
        vscode.tasks.onDidStartTask.fire({ execution })
        return execution
      },
      onDidStartTask: emitter(),
      onDidEndTask: emitter(),
      onDidEndTaskProcess: emitter(),
    },
  }

  return { vscode, state, uri }
}

/** Makes `require('vscode')` return the stub. */
function install(vscode) {
  const original = Module._load
  Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscode : original.call(this, request, ...rest)
  }
}

module.exports = { createStub, install }

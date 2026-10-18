const vscode = require('vscode')
const { getConfig } = require('./config')

// Per-workspace so that several open VS Code windows don't all fire the same job
const WORKSPACE_SCHEDULES_KEY = 'terminal-mate.schedules'
const TICK_MS = 1000
const MIN_REPEAT_MS = 10 * 1000
const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }
const SCHEDULE_EXAMPLES = 'e.g. 10m · 1h30m · 14:30 · every 15m · daily 09:00'

function parseDuration(text) {
  const compact = String(text || '').replace(/\s+/g, '')
  if (!/^(\d+[smhd])+$/.test(compact)) return null
  const regex = /(\d+)([smhd])/g
  let total = 0
  let match
  while ((match = regex.exec(compact)) !== null) total += Number(match[1]) * UNIT_MS[match[2]]
  return total > 0 ? total : null
}

function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

function nextClockTime(clock, from) {
  const date = new Date(from)
  date.setHours(clock.hours, clock.minutes, 0, 0)
  if (date.getTime() <= from) date.setDate(date.getDate() + 1)
  return date.getTime()
}

// Supported: "10m", "in 1h30m", "14:30", "at 14:30", "every 15m", "daily 09:00", "every day at 09:00"
function parseSchedule(input, now = Date.now()) {
  const text = String(input || '').trim().toLowerCase()
  let match

  if ((match = /^(?:daily|every\s+day)(?:\s+at)?\s+(\S+)$/.exec(text))) {
    const clock = parseClock(match[1])
    if (!clock) return null
    return { repeat: 'daily', clock, nextRun: nextClockTime(clock, now) }
  }

  if ((match = /^every\s+(.+)$/.exec(text))) {
    const everyMs = parseDuration(match[1])
    if (!everyMs || everyMs < MIN_REPEAT_MS) return null
    return { repeat: 'interval', everyMs, nextRun: now + everyMs }
  }

  const body = text.replace(/^(in|at)\s+/, '')
  const clock = parseClock(body)
  if (clock) return { repeat: 'once', nextRun: nextClockTime(clock, now) }
  const delayMs = parseDuration(body)
  if (delayMs) return { repeat: 'once', nextRun: now + delayMs }
  return null
}

function formatDuration(ms) {
  let seconds = Math.max(0, Math.round(ms / 1000))
  const parts = []
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60]]) {
    if (seconds >= size) {
      parts.push(`${Math.floor(seconds / size)}${unit}`)
      seconds %= size
    }
  }
  if (!parts.length || (parts.length < 2 && seconds)) parts.push(`${seconds}s`)
  return parts.join(' ')
}

function formatClock(clock) {
  return `${String(clock.hours).padStart(2, '0')}:${String(clock.minutes).padStart(2, '0')}`
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  const time = formatClock({ hours: date.getHours(), minutes: date.getMinutes() })
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString()} ${time}`
}

function describeRepeat(job) {
  if (job.repeat === 'interval') return `every ${formatDuration(job.everyMs)}`
  if (job.repeat === 'daily') return `daily at ${formatClock(job.clock)}`
  return 'once'
}

// Returns the job with its next future run, or null when it should be removed
function advanceJob(job, now) {
  if (job.repeat === 'interval') {
    const skipped = Math.floor((now - job.nextRun) / job.everyMs) + 1
    return { ...job, nextRun: job.nextRun + skipped * job.everyMs }
  }
  if (job.repeat === 'daily') return { ...job, nextRun: nextClockTime(job.clock, now) }
  return null
}

function registerScheduler(context, api) {
  let ticking = false

  const loadJobs = () => context.workspaceState.get(WORKSPACE_SCHEDULES_KEY, [])
  const saveJobs = (jobs) => context.workspaceState.update(WORKSPACE_SCHEDULES_KEY, jobs)

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94)
  statusItem.command = 'terminal-mate.scheduledCommands'
  context.subscriptions.push(statusItem)

  const updateStatus = () => {
    const jobs = loadJobs()
    if (!jobs.length || !getConfig().get('showStatusBar', true)) {
      statusItem.hide()
      return
    }
    const now = Date.now()
    const next = jobs.reduce((a, b) => (a.nextRun <= b.nextRun ? a : b))
    statusItem.text = `$(clock) ${next.title} in ${formatDuration(next.nextRun - now)}`
    statusItem.tooltip = jobs
      .map((job) => `${job.title} — ${describeRepeat(job)}, next at ${formatTime(job.nextRun)}`)
      .join('\n')
    statusItem.show()
  }

  const runJob = async (job) => {
    try {
      // Dedicated terminal, so a scheduled run never types into a terminal you are using
      const name = `${job.title} (scheduled)`
      let terminal = vscode.window.terminals.find((term) => term.name === name)
      if (!terminal) terminal = vscode.window.createTerminal({ name, cwd: job.cwd || undefined })
      terminal.show(true)
      terminal.sendText(job.command)
      await api.pushHistory(job.title, job.command)
      if (job.repeat === 'once') {
        vscode.window.showInformationMessage(`TerminalMate: Ran scheduled command "${job.title}".`)
      } else {
        vscode.window.setStatusBarMessage(`TerminalMate: Ran "${job.title}"`, 5000)
      }
    } catch (error) {
      vscode.window.showErrorMessage(`TerminalMate: Scheduled "${job.title}" failed: ${error.message}`)
    }
  }

  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      const now = Date.now()
      const jobs = loadJobs()
      const due = jobs.filter((job) => job.nextRun <= now)
      if (due.length) {
        await saveJobs(jobs.map((job) => (job.nextRun <= now ? advanceJob(job, now) : job)).filter(Boolean))
        for (const job of due) await runJob(job)
      }
      updateStatus()
    } finally {
      ticking = false
    }
  }

  // Jobs that came due while VS Code was closed: recurring ones just move on to
  // their next run, one-shot ones are offered to the user instead of firing blindly
  const takeMissedOnStartup = async () => {
    const now = Date.now()
    const jobs = loadJobs()
    const missed = jobs.filter((job) => job.nextRun <= now)
    if (!missed.length) return []
    await saveJobs(jobs.map((job) => (job.nextRun <= now ? advanceJob(job, now) : job)).filter(Boolean))
    return missed.filter((job) => job.repeat === 'once')
  }

  const offerMissed = async (missed) => {
    if (!missed.length) return
    const names = missed.map((job) => `"${job.title}"`).join(', ')
    const choice = await vscode.window.showWarningMessage(
      `TerminalMate: Scheduled command(s) missed while VS Code was closed: ${names}`,
      'Run now',
      'Discard'
    )
    if (choice !== 'Run now') return
    for (const job of missed) await runJob(job)
  }

  const addJob = async (job) => {
    await saveJobs([...loadJobs(), job])
    updateStatus()
  }

  const removeJob = async (id) => {
    await saveJobs(loadJobs().filter((job) => job.id !== id))
    updateStatus()
  }

  const pickEntry = async () => {
    const entries = (getConfig().get('customTerminals', []) || []).filter(
      (entry) => entry && typeof entry.title === 'string' && typeof entry.command === 'string' && entry.title.trim() && entry.command.trim()
    )
    const oneOffItem = { label: '$(edit) Type a one-off command', alwaysShow: true }
    const picked = await vscode.window.showQuickPick(
      [oneOffItem, ...entries.map((entry) => ({ label: entry.title.trim(), description: entry.command.trim(), entry }))],
      { placeHolder: 'Select a command to schedule' }
    )
    if (!picked) return null
    if (picked.entry) return picked.entry

    const command = await vscode.window.showInputBox({
      prompt: 'Shell command to schedule',
      placeHolder: 'e.g. npm run build',
      validateInput: (v) => (v?.trim() ? null : 'Command cannot be empty'),
    })
    if (!command?.trim()) return null
    const title = await vscode.window.showInputBox({
      prompt: 'Title for this scheduled command',
      value: command.trim().split(/\s+/).slice(0, 3).join(' '),
      validateInput: (v) => (v?.trim() ? null : 'Title cannot be empty'),
    })
    if (!title?.trim()) return null
    return { title: title.trim(), command: command.trim() }
  }

  const scheduleCommand = vscode.commands.registerCommand('terminal-mate.scheduleCommand', async (entryArg) => {
    try {
      const entry = entryArg && entryArg.command ? entryArg : await pickEntry()
      if (!entry) return

      const when = await vscode.window.showInputBox({
        prompt: `When should "${entry.title}" run?`,
        placeHolder: SCHEDULE_EXAMPLES,
        validateInput: (v) =>
          !v?.trim() || parseSchedule(v)
            ? null
            : `Not recognized (${SCHEDULE_EXAMPLES}). Repeats must be at least ${formatDuration(MIN_REPEAT_MS)}.`,
      })
      if (!when?.trim()) return
      const schedule = parseSchedule(when)
      if (!schedule) return

      // Placeholders and confirmations are resolved now: nobody may be around when it fires
      const folder = api.getActiveFolder()
      const { result, cursorSymbol } = await api.resolvePlaceholders(entry.command.trim(), folder)
      if (result.includes(cursorSymbol)) {
        vscode.window.showWarningMessage('TerminalMate: Snippets with a cursor marker cannot be scheduled.')
        return
      }
      if (!(await api.confirmDangerousIfNeeded(result))) return

      const job = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        title: entry.title.trim(),
        command: result,
        cwd: entry.cwd || folder?.uri?.fsPath || null,
        ...schedule,
        // Re-parse on the final value so the "now" reference is the moment of saving
        nextRun: parseSchedule(when).nextRun,
      }
      await addJob(job)
      vscode.window.showInformationMessage(
        `TerminalMate: "${job.title}" scheduled ${describeRepeat(job)}, next run at ${formatTime(job.nextRun)} (in ${formatDuration(job.nextRun - Date.now())}).`
      )
    } catch (error) {
      vscode.window.showErrorMessage(`TerminalMate: ${error.message}`)
    }
  })
  context.subscriptions.push(scheduleCommand)

  const listCommand = vscode.commands.registerCommand('terminal-mate.scheduledCommands', async () => {
    const now = Date.now()
    const jobs = [...loadJobs()].sort((a, b) => a.nextRun - b.nextRun)
    const addItem = { label: '$(add) Schedule a command', alwaysShow: true }
    const runButton = { iconPath: new vscode.ThemeIcon('play'), tooltip: 'Run now' }
    const cancelButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Cancel schedule' }

    const qp = vscode.window.createQuickPick()
    qp.placeholder = jobs.length ? 'Scheduled commands (this workspace)' : 'No scheduled commands yet'
    qp.items = [
      addItem,
      ...jobs.map((job) => ({
        label: `$(clock) ${job.title}`,
        description: `${describeRepeat(job)} · next ${formatTime(job.nextRun)} (in ${formatDuration(job.nextRun - now)})`,
        detail: job.command,
        job,
        buttons: [runButton, cancelButton],
      })),
    ]

    const act = async (job, action) => {
      if (action === 'Cancel schedule') {
        await removeJob(job.id)
        vscode.window.showInformationMessage(`TerminalMate: Schedule for "${job.title}" cancelled.`)
      } else if (action === 'Run now') {
        await runJob(job)
      }
    }

    qp.onDidTriggerItemButton(async ({ button, item }) => {
      qp.hide()
      await act(item.job, button.tooltip)
    })
    qp.onDidAccept(async () => {
      const [selected] = qp.selectedItems
      qp.hide()
      if (!selected) return
      if (!selected.job) {
        await vscode.commands.executeCommand('terminal-mate.scheduleCommand')
        return
      }
      const action = await vscode.window.showQuickPick(['Run now', 'Cancel schedule'], {
        placeHolder: `${selected.job.title} — ${describeRepeat(selected.job)}`,
      })
      if (action) await act(selected.job, action)
    })
    qp.onDidHide(() => qp.dispose())
    qp.show()
  })
  context.subscriptions.push(listCommand)

  const onConfigChange = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('terminal-mate.showStatusBar')) updateStatus()
  })
  context.subscriptions.push(onConfigChange)

  takeMissedOnStartup().then((missed) => {
    const interval = setInterval(tick, TICK_MS)
    context.subscriptions.push({ dispose: () => clearInterval(interval) })
    updateStatus()
    offerMissed(missed)
  })
}

module.exports = { registerScheduler, parseSchedule, formatDuration }

const vscode = require('vscode')
const { getConfig, updateSetting } = require('./config')
const { arrange, moveEntry } = require('./ordering')
const { listShells, resolveShell } = require('./shells')
const { entryLabel } = require('./statusBarProvider')
const { ALL_SOURCES } = require('./projects')
const { SOURCE_LABELS } = require('./sources')
const { listEnvFiles } = require('./envFiles')

const icon = (name) => new vscode.ThemeIcon(name)
const SEPARATOR = vscode.QuickPickItemKind.Separator

/** Asks which shell to use. Returns a shell id ("default", "pwsh", ...) or undefined. */
async function pickShell(placeHolder, current) {
  const shells = listShells(vscode.env.shell)
  const pick = await vscode.window.showQuickPick(
    shells.map((shell) => ({
      label: shell.id === current ? `$(check) ${shell.label}` : shell.label,
      description: shell.detail,
      id: shell.id,
    })),
    { placeHolder }
  )
  return pick?.id
}

/**
 * The script window: run, stop, star, hide, reorder, run with arguments or
 * in another shell, manage groups, and change the most used settings.
 *
 * `host` is the orchestrator (see scripts.js).
 */
function createPicker(host) {
  const { store } = host

  function arrangeGroup(group) {
    return arrange(group.entries, {
      favorites: store.favorites(),
      hidden: store.hidden(),
      customOrder: store.order(group.key),
      scriptOrder: getConfig().get('scriptOrder', []),
    })
  }

  function describe(entry) {
    if (entry.variants) return `in ${entry.variants.length} projects - choose on run`
    // Where a script comes from is only worth saying when it is not package.json.
    const command = entry.kind === 'npm' ? entry.command : `${entry.kind}: ${entry.command}`
    const code = host.isRunning(entry) ? undefined : host.failure(entry)
    const envFile = host.envFileOf(entry)
    return [code !== undefined ? `failed, exit code ${code}` : '', envFile ? `env: ${envFile}` : '', command]
      .filter(Boolean)
      .join(' - ')
  }

  function makeItem(entry, group, state, showProject) {
    const running = host.isRunning(entry)
    const failedRun = !running && host.failure(entry) !== undefined
    const prefix = running ? '$(sync~spin) ' : failedRun ? '$(error) ' : state === 'favorite' ? '$(star-full) ' : ''
    const buttons = []
    const add = (action, iconName, tooltip) => buttons.push({ iconPath: icon(iconName), tooltip, action })

    if (running) add('stop', 'debug-stop', 'Stop')
    if (state === 'hidden') {
      add('hide', 'eye-closed', 'Show again')
    } else {
      add('up', 'arrow-up', 'Move up')
      add('down', 'arrow-down', 'Move down')
      add(
        'star',
        state === 'favorite' ? 'star-full' : 'star-empty',
        state === 'favorite' ? 'Remove from favorites' : 'Add to favorites (favorites come first)'
      )
      add('hide', 'eye', 'Hide (moves to the Hidden section at the bottom)')
    }
    add('options', 'terminal', 'Run with options: arguments, an env file, or another shell')

    return {
      label: `${prefix}${entry.name}`,
      description: showProject && entry.project ? `${entry.project.name} - ${describe(entry)}` : describe(entry),
      buttons,
      entry,
      group,
    }
  }

  function makeGroupItem(group) {
    const entries = host.groupEntries(group)
    const running = entries.some(host.isRunning)
    const buttons = []
    if (running) buttons.push({ iconPath: icon('debug-stop'), tooltip: 'Stop all scripts of this group', action: 'stopGroup' })
    if (!group.shared && entries.length) {
      buttons.push({
        iconPath: icon('organization'),
        tooltip: 'Share with the team: move this group to the workspace settings (.vscode/settings.json)',
        action: 'shareGroup',
      })
    }
    buttons.push(
      { iconPath: icon('edit'), tooltip: 'Change the scripts or the name of this group', action: 'editGroup' },
      { iconPath: icon('trash'), tooltip: 'Delete this group (the scripts stay)', action: 'deleteGroup' }
    )
    const list = entries.length
      ? entries.map((entry) => `${entry.project.name}: ${entryLabel(entry)}`).join(', ')
      : 'its scripts no longer exist'
    return {
      label: `${running ? '$(sync~spin)' : '$(run-all)'} ${group.name}`,
      description: group.shared ? `shared in settings - ${list}` : list,
      buttons,
      runGroup: group,
    }
  }

  function buildItems(projectId) {
    const groups = host.getGroups(projectId)
    const items = []
    const hiddenItems = []

    const runGroups = projectId ? [] : host.allGroups()
    if (runGroups.length) {
      items.push({ label: 'Groups', kind: SEPARATOR }, ...runGroups.map(makeGroupItem))
    }

    for (const group of groups) {
      const arranged = arrangeGroup(group)
      const visible = [
        ...arranged.favorites.map((entry) => makeItem(entry, group, 'favorite', false)),
        ...arranged.others.map((entry) => makeItem(entry, group, 'other', false)),
      ]
      if ((groups.length > 1 || runGroups.length) && visible.length) {
        items.push({ label: group.label, kind: SEPARATOR })
      }
      items.push(...visible)
      hiddenItems.push(...arranged.hidden.map((entry) => makeItem(entry, group, 'hidden', groups.length > 1)))
    }

    if (hiddenItems.length) items.push({ label: 'Hidden', kind: SEPARATOR }, ...hiddenItems)
    return items
  }

  /**
   * Asks which env file a script should run with, remembers the answer for
   * that script and returns it ('' for none). Returns undefined on Escape.
   */
  async function chooseEnvFile(entry) {
    const files = await listEnvFiles(entry.project)
    const current = host.envFileOf(entry)
    const mark = (file) => (file === current ? '$(check) ' : '')
    if (!files.length && !current) {
      vscode.window.showInformationMessage(
        `RunMate: no env files (.env, .env.local, .env.staging, ...) were found in ${entry.project.name}.`
      )
      return undefined
    }
    const pick = await vscode.window.showQuickPick(
      [
        { label: `${mark('')}$(circle-slash) No env file`, description: 'run with the normal environment', file: '' },
        ...files.map((file) => ({ label: `${mark(file)}$(file) ${file}`, description: 'load its variables, then run', file })),
      ],
      {
        title: `Env file for '${entry.name}'`,
        placeHolder: `RunMate remembers the choice for '${entry.name}' until you change it here`,
      }
    )
    if (!pick) return undefined
    await store.setEnvFile(entry.key, pick.file)
    host.render()
    return pick.file
  }

  /** "Run with options": arguments (new or used before), an env file, or another shell for this run. */
  async function runWithOptions(entry) {
    const recent = store.recentArgs(entry.key)
    const envFile = entry.project ? host.envFileOf(entry) : ''
    const pick = await vscode.window.showQuickPick(
      [
        { label: '$(symbol-parameter) Run with arguments...', description: 'for example --watch', id: 'args' },
        ...recent.map((args) => ({ label: `$(history) ${args}`, description: 'run again with these arguments', args })),
        // A script that exists in several projects has no single folder to look for env files in.
        ...(entry.project
          ? [
              {
                label: `$(file) Run with an env file... (now: ${envFile || 'none'})`,
                description: '.env.local, .env.staging, ... remembered for this script',
                id: 'env',
              },
            ]
          : []),
        { label: 'Run once in another shell', kind: SEPARATOR },
        ...listShells(vscode.env.shell).map((shell) => ({
          label: `$(terminal) ${shell.label}`,
          description: shell.detail,
          shell: shell.id,
        })),
      ],
      { title: `Run '${entry.name}' with options` }
    )
    if (!pick) return

    if (pick.shell) return host.runEntry(entry, { shell: pick.shell })

    if (pick.id === 'env') {
      const file = await chooseEnvFile(entry)
      if (file === undefined) return
      return host.runEntry(entry, { envFile: file })
    }

    let args = pick.args
    if (pick.id === 'args') {
      args = await vscode.window.showInputBox({
        title: `Arguments for '${entry.name}'`,
        prompt: 'Added after the script name exactly as you type them. Leave empty to run without arguments.',
        value: recent[0] || '',
      })
      if (args === undefined) return
      args = args.trim()
    }
    if (args) await store.addRecentArgs(entry.key, args)
    return host.runEntry(entry, args ? { args } : {})
  }

  /** Creates a group, or changes an existing one. */
  async function editGroup(existing) {
    const entries = host.getProjects().flatMap((project) => project.entries)
    const chosen = new Set(existing ? host.groupEntries(existing).map((entry) => entry.key) : [])
    const picks = await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: entryLabel(entry),
        description: `${entry.project.name} - ${entry.command}`,
        picked: chosen.has(entry.key),
        entry,
      })),
      {
        canPickMany: true,
        title: existing ? `Scripts of group "${existing.name}"` : 'New group: tick the scripts that should start together',
        placeHolder: 'Tick two or more scripts, then press Enter',
      }
    )
    if (!picks || !picks.length) return

    const names = [...new Set(picks.map((pick) => pick.entry.name))]
    const name = await vscode.window.showInputBox({
      title: 'Name of the group',
      prompt: 'This is the text of its status bar button.',
      value: existing ? existing.name : names.length === 1 ? `${names[0]} all` : 'my group',
      validateInput: (text) => (text.trim() ? null : 'Enter a name'),
    })
    if (name === undefined) return

    await host.saveGroup(
      existing,
      name.trim(),
      picks.map((pick) => pick.entry)
    )
    host.render()
  }

  function show(projectId) {
    const project = projectId ? host.getProjects().find((p) => p.id === projectId) : null
    if (!host.getProjects().length) {
      vscode.window.showInformationMessage(
        'RunMate: nothing to run was found in this workspace (no package.json scripts, Deno tasks, Makefile targets or just recipes).'
      )
      return
    }

    const qp = vscode.window.createQuickPick()
    qp.title = project ? `RunMate - ${project.name}` : 'RunMate - Scripts'
    qp.placeholder = 'Type to filter, Enter to run. Buttons on a row: move, star, hide, run with options'
    qp.matchOnDescription = true
    qp.keepScrollPosition = true

    const shellLabel = resolveShell(getConfig().get('shell', 'default'), vscode.env.shell).label
    const groupButton = { iconPath: icon('add'), tooltip: 'New group: start several scripts with one click' }
    const shellButton = { iconPath: icon('terminal'), tooltip: `Shell for scripts: ${shellLabel}. Click to change` }
    const refreshButton = { iconPath: icon('refresh'), tooltip: 'Look for projects and scripts again' }
    const settingsButton = { iconPath: icon('gear'), tooltip: 'RunMate settings' }
    qp.buttons = [groupButton, shellButton, refreshButton, settingsButton]

    const refresh = (keep) => {
      qp.items = buildItems(projectId)
      const active = keep && qp.items.find(keep)
      if (active) qp.activeItems = [active]
    }
    refresh()

    // Sub-dialogs replace this picker. Unless the work returns false, the
    // picker comes back afterwards, rebuilt from whatever was just changed.
    const leave = async (work) => {
      qp.hide()
      if ((await work()) === false) return
      await host.rediscover()
      show(projectId)
    }

    qp.onDidTriggerButton((button) => {
      if (button === groupButton) {
        leave(() => editGroup())
      } else if (button === shellButton) {
        leave(async () => {
          const shell = await pickShell('Shell RunMate uses for scripts', getConfig().get('shell', 'default'))
          if (shell) await updateSetting('shell', shell)
        })
      } else if (button === refreshButton) {
        leave(() => undefined)
      } else if (button === settingsButton) {
        leave(() => showSettings())
      }
    })

    qp.onDidTriggerItemButton(async ({ item, button }) => {
      if (item.runGroup) {
        const group = item.runGroup
        if (button.action === 'editGroup') return leave(() => editGroup(group))
        if (button.action === 'stopGroup') await host.stopGroup(group)
        if (button.action === 'deleteGroup') await host.deleteGroup(group)
        if (button.action === 'shareGroup') {
          await host.shareGroup(group)
          vscode.window.showInformationMessage(
            `RunMate: group "${group.name}" is now in the workspace settings. Commit .vscode/settings.json and your team gets the same button.`
          )
        }
        host.render()
        refresh((other) => other.runGroup?.id === group.id)
        return
      }

      const { entry, group } = item
      switch (button.action) {
        case 'stop':
          await host.stopEntry(entry)
          break
        case 'star':
          await store.toggleFavorite(entry.key)
          break
        case 'hide':
          await store.toggleHidden(entry.key)
          break
        case 'up':
        case 'down': {
          const order = moveEntry(arrangeGroup(group), entry, button.action === 'up' ? -1 : 1)
          if (!order) return
          await store.setOrder(group.key, order)
          break
        }
        case 'options':
          leave(async () => {
            await runWithOptions(entry)
            return false
          })
          return
        default:
          return
      }
      host.render()
      refresh((other) => other.entry?.id === entry.id)
    })

    qp.onDidAccept(() => {
      const [selected] = qp.selectedItems
      qp.hide()
      if (selected?.runGroup) host.runGroup(selected.runGroup)
      else if (selected?.entry) host.runEntry(selected.entry)
    })

    qp.onDidHide(() => qp.dispose())
    qp.show()
  }

  /**
   * Settings menu. Stays open until Escape or "Back to scripts"; returns
   * false when it handed over to the Settings editor instead.
   */
  async function showSettings() {
    for (;;) {
      const cfg = getConfig()
      const onOff = (key, fallback) => (cfg.get(key, fallback) ? 'on' : 'off')
      const shellLabel = resolveShell(cfg.get('shell', 'default'), vscode.env.shell).label
      const layout = cfg.get('pickerOnly', false) ? 'picker' : cfg.get('statusBarLayout', 'auto')
      const sources = ALL_SOURCES.filter((kind) => cfg.get('scriptSources', ALL_SOURCES).includes(kind))

      const pick = await vscode.window.showQuickPick(
        [
          { label: '$(arrow-left) Back to scripts', id: 'back' },
          { label: 'Status bar', kind: SEPARATOR },
          { label: `$(symbol-number) Script buttons shown: ${cfg.get('maxDynamicScriptButtons', 8)}`, description: 'how many scripts get their own button', id: 'max' },
          { label: `$(layout) Layout: ${layout}`, description: 'a button per script, per project, or one button', id: 'layout' },
          { label: `$(arrow-swap) Side: ${cfg.get('statusBarSide', 'left')}`, description: 'left or right end of the status bar', id: 'side' },
          { label: 'What RunMate looks for', kind: SEPARATOR },
          { label: `$(folder-library) Projects in subfolders: ${onOff('nestedProjects', true)}`, description: 'apps/web, packages/ui and so on', id: 'nested' },
          { label: `$(list-selection) Sources: ${sources.join(', ') || 'none'}`, description: 'package.json, Deno, Makefile, just', id: 'sources' },
          { label: 'Running', kind: SEPARATOR },
          { label: `$(terminal) Shell: ${shellLabel}`, id: 'shell' },
          { label: `$(versions) Node version manager: ${cfg.get('nodeVersionManager', 'auto')}`, id: 'manager' },
          { label: `$(shield) Checks before a run: ${onOff('preflightChecks', true)}`, description: 'offer to install a missing Node version or package manager', id: 'checks' },
          { label: `$(cloud-download) Install missing dependencies: ${onOff('autoInstallMissingDependencies', true)}`, id: 'deps' },
          { label: `$(plug) Check the port before a run: ${onOff('checkPorts', true)}`, description: 'warn when the port of a dev server is taken, and offer to free it', id: 'ports' },
          { label: `$(bell) Tell me when a script fails: ${onOff('notifyOnFailure', true)}`, description: 'a message with "Run again"', id: 'notify' },
          { label: `$(file) Env file for all scripts: ${cfg.get('envFile', '') || 'none'}`, description: 'for one script, use its "Run with options" button', id: 'envFile' },
          { label: 'This list', kind: SEPARATOR },
          { label: `$(eye) Show all hidden scripts (${store.hidden().size})`, id: 'unhide' },
          { label: '$(discard) Reset my order', description: 'back to the default order', id: 'resetOrder' },
          { label: '$(settings-gear) Open all RunMate settings', id: 'open' },
          { label: '$(mortar-board) Open the getting started guide', description: 'a short tour of RunMate', id: 'guide' },
        ],
        { title: 'RunMate settings', placeHolder: 'Choose a setting to change' }
      )

      if (!pick || pick.id === 'back') return

      switch (pick.id) {
        case 'max': {
          const value = await vscode.window.showInputBox({
            title: 'Script buttons shown in the status bar',
            prompt: 'The other scripts stay in the list. 0 shows only the list button.',
            value: String(cfg.get('maxDynamicScriptButtons', 8)),
            validateInput: (text) => (/^\d{1,2}$/.test(text.trim()) ? null : 'Enter a number from 0 to 99'),
          })
          if (value !== undefined) await updateSetting('maxDynamicScriptButtons', Number(value.trim()))
          break
        }
        case 'layout': {
          const choice = await vscode.window.showQuickPick(
            [
              { label: 'auto', description: 'script buttons for one project, one button per project for several' },
              { label: 'scripts', description: 'a button for each script' },
              { label: 'projects', description: 'a button for each project; click it to see its scripts' },
              { label: 'picker', description: 'a single "Scripts" button' },
            ],
            { placeHolder: 'Status bar layout' }
          )
          if (choice) {
            if (cfg.get('pickerOnly', false)) await updateSetting('pickerOnly', false)
            await updateSetting('statusBarLayout', choice.label)
          }
          break
        }
        case 'side':
          await updateSetting('statusBarSide', cfg.get('statusBarSide', 'left') === 'left' ? 'right' : 'left')
          break
        case 'nested':
          await updateSetting('nestedProjects', !cfg.get('nestedProjects', true))
          break
        case 'sources': {
          const picks = await vscode.window.showQuickPick(
            ALL_SOURCES.map((kind) => ({ label: kind, description: SOURCE_LABELS[kind], picked: sources.includes(kind) })),
            { canPickMany: true, placeHolder: 'Tick what RunMate should show' }
          )
          if (picks) await updateSetting('scriptSources', picks.map((p) => p.label))
          break
        }
        case 'shell': {
          const shell = await pickShell('Shell RunMate uses for scripts', cfg.get('shell', 'default'))
          if (shell) await updateSetting('shell', shell)
          break
        }
        case 'manager': {
          const choice = await vscode.window.showQuickPick(
            [
              { label: 'auto', description: 'use whichever is installed (nvm, fnm, Volta)' },
              { label: 'nvm', description: 'nvm, or nvm for Windows' },
              { label: 'fnm' },
              { label: 'volta' },
              { label: 'none', description: 'never switch the Node version' },
            ],
            { placeHolder: 'Node version manager' }
          )
          if (choice) await updateSetting('nodeVersionManager', choice.label)
          break
        }
        case 'checks':
          await updateSetting('preflightChecks', !cfg.get('preflightChecks', true))
          break
        case 'deps':
          await updateSetting('autoInstallMissingDependencies', !cfg.get('autoInstallMissingDependencies', true))
          break
        case 'ports':
          await updateSetting('checkPorts', !cfg.get('checkPorts', true))
          break
        case 'notify':
          await updateSetting('notifyOnFailure', !cfg.get('notifyOnFailure', true))
          break
        case 'envFile': {
          const value = await vscode.window.showInputBox({
            title: 'Env file for all scripts',
            prompt: 'A file name inside each project, for example .env.local. Leave empty for none. Projects without this file run as usual.',
            value: cfg.get('envFile', ''),
          })
          if (value !== undefined) await updateSetting('envFile', value.trim())
          break
        }
        case 'guide':
          await vscode.commands.executeCommand('run-mate-script-runner.openGuide')
          return false
        case 'unhide':
          await store.clearHidden()
          host.render()
          break
        case 'resetOrder':
          await store.clearOrder()
          host.render()
          break
        case 'open':
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:SanekxArcs.run-mate-script-runner')
          return false
      }
    }
  }

  return { show, editGroup }
}

module.exports = { createPicker }

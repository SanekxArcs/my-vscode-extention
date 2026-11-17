# TerminalMate

Custom command snippets, history, and status bar shortcuts for professional terminal workflows. Automate repetitive shell commands with intelligent placeholders and a "no-coding" experience.

## ✨ Features
- **Status Bar Menu**: A dedicated button (labeled "TM") to quickly access all your saved custom commands.
- **Intelligent Placeholders**: Support for dynamic input (`${input:}`), option picks (`${pick:}`), environment variables (`${env:}`), workspace path (`${workspaceFolder}`), and clipboard content (`${clipboard}`).
- **Interactive Snippets**: Use cursor markers (`<|>`) to pause execution for manual typing before finishing the command.
- **Safety First**: Optional confirmation for dangerous commands (like `git reset --hard` or `force push`) and a preview modal.
- **Quick Access**: Pinned last-used command for one-click re-runs and a persistent QuickPick history.
- **Smart Re-use**: Automatically re-uses terminal windows matched by the snippet title or configuration.
- **Cross-Platform**: Filter commands by OS (win32, darwin, linux) to keep your workspace clean.
- **Scheduled Commands**: Run a saved or one-off command later, at a time of day, or on repeat. Click the clock button next to a command, or run `TerminalMate: Schedule Command`.
- **Reorder Commands**: Use the ↑/↓ buttons next to a command in the menu to move it up or down. The menu stays open, so you can click several times.
- **Archive Commands**: Click the archive button next to a command to hide it from the list without deleting it. Open `Archive (N)` at the bottom of the menu to restore or delete archived commands.
- **Groups**: Put commands in a group to show them together under a heading. Set it from the edit button → **Group**.
- **Chains**: Run several saved commands in a row with one click.
- **Keyboard Shortcuts**: Bind any saved command to a key.
- **Import / Export**: Share your command list as a JSON file.
- **Edit Menu**: The edit button next to a command opens a menu to change its title, command, working directory or group, duplicate it, or give it a shortcut.

## 🔗 Chains
A chain runs saved commands one after another in the same terminal. Choose **Add new chain** at the bottom of the menu, give it a title, and pick the steps in order. In settings it looks like this:

```json
{ "title": "Build and deploy", "chain": ["Build", "Deploy"] }
```

- Steps are the titles of your saved commands. Renaming a command from the edit menu updates the chains that use it.
- A chain stops at the first step that fails. This needs VS Code's terminal shell integration (VS Code 1.93+, on by default for bash, zsh, fish and PowerShell). Without it, all steps are sent to the terminal in order and nothing checks whether a step failed.
- All steps run in the chain's terminal and working directory. The `cwd` of a single step is not used.
- Placeholders and dangerous-command confirmations for every step are asked before the first step runs. Steps with a cursor marker can't be used in a chain.
- Chains can be scheduled like any other command.

## ⌨️ Keyboard shortcuts
Open the edit menu of a command and choose **Keyboard shortcut**. A ready keybinding is copied and `keybindings.json` opens. Paste it and set the key you want:

```json
{ "key": "ctrl+alt+d", "command": "terminal-mate.run", "args": "Deploy" }
```

`args` is the title of the saved command or chain.

## ⏰ Scheduling
When prompted "When should it run?", type one of these:

| Input | Meaning |
|-------|---------|
| `10m`, `in 1h30m`, `45s` | Once, after a delay |
| `14:30`, `at 14:30` | Once, at the next 14:30 |
| `every 15m` | Repeats every 15 minutes (minimum 10s) |
| `daily 09:00`, `every day at 09:00` | Every day at 09:00 |

- Placeholders (`${input:}`, `${pick:}`, …) and dangerous-command confirmation are handled **when you schedule** the command, so nothing asks you questions when it runs. Snippets with a cursor marker can't be scheduled.
- Scheduled runs use their own terminal (`<title> (scheduled)`), so they never type into a terminal you are working in.
- Schedules are saved per workspace and survive restarts. Schedules run only while VS Code is open. If a one-time command was missed while VS Code was closed, you are asked whether to run it now. A missed repeating command skips ahead to its next time.
- The status bar shows the next run with a countdown. Click it to see, run, or cancel your schedules.
- To run commands while VS Code is closed, use your OS scheduler instead (`cron`/systemd timers, Task Scheduler, launchd).

## 🚀 Commands
- `TerminalMate: Open Saved Commands`
- `TerminalMate: Run Last Command`
- `TerminalMate: Finish Snippet`
- `TerminalMate: History`
- `TerminalMate: Schedule Command`
- `TerminalMate: Scheduled Commands`
- `TerminalMate: Import Commands`
- `TerminalMate: Export Commands`

## ⚙️ Settings (`terminal-mate`)
- `customTerminals`: Your collection of command objects `{ title, command, cwd, reuse, os, group, archived }`, or chains `{ title, chain }`.
- `customTerminalsButtonLabel`: Customize the Status Bar button text (default: "TM").
- `sortCommands`: `manual` (your own order, default), `recent` (last used first) or `frequent` (most used first). Applied inside each group.
- `dangerousCommandPatterns`: Regular expressions for commands that ask for confirmation. Add your own, for example `rm\\s+-rf`.
- `cursorSymbol`: Marker for manual cursor placement (default: `<|>`).
- `showPreviewForCustomTerminals`: Toggle a "Are you sure?" modal before execution.
- `reuseTerminalByTitle`: Control terminal window recycling.
- `customHistorySize`: Number of recent commands to remember.
- `confirmDangerousCommands`: Smart protection against common risky shell commands.
- `pinLastCustomTerminal`: Show a "pinned" button for your most recent action.
- `showStatusBar`: Toggle the entire status bar integration.

## 🏃 Quick Start
1. Click **TM** in the status bar and choose **Add new command**.
2. Enter a title, for example `Fixup`, and a command, for example `git commit --fixup ${input:SHA}`.
3. Click **TM** again and select **Fixup**.

You can also edit the list by hand in `terminal-mate.customTerminals` in your settings:

```json
{
  "title": "Fixup",
  "command": "git commit --fixup ${input:SHA}"
}
```

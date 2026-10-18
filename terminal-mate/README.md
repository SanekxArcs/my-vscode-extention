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

## ⚙️ Settings (`terminal-mate`)
- `customTerminals`: Your collection of command objects `{ title, command, cwd, reuse, os }`.
- `customTerminalsButtonLabel`: Customize the Status Bar button text (default: "TM").
- `cursorSymbol`: Marker for manual cursor placement (default: `<|>`).
- `showPreviewForCustomTerminals`: Toggle a "Are you sure?" modal before execution.
- `reuseTerminalByTitle`: Control terminal window recycling.
- `customHistorySize`: Number of recent commands to remember.
- `confirmDangerousCommands`: Smart protection against common risky shell commands.
- `pinLastCustomTerminal`: Show a "pinned" button for your most recent action.
- `showStatusBar`: Toggle the entire status bar integration.

## 🏃 Quick Start
1. Open your VS Code Settings (JSON or UI).
2. Look for `terminal-mate.customTerminals`.
3. Add a basic command:
   ```json
   {
     "title": "Fixup",
     "command": "git commit --fixup ${input:SHA}"
   }
   ```
4. Click **TM** in the status bar and select **Fixup**.

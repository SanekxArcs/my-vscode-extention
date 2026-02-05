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

## 🚀 Commands
- `TerminalMate: Open Saved Commands`
- `TerminalMate: Run Last Command`
- `TerminalMate: Finish Snippet`
- `TerminalMate: History`

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

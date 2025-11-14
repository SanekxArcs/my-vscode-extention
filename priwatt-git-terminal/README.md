# Priwatt Git Terminal

Create reusable terminal snippets with placeholders, history, and status bar shortcuts. Ideal for git flows or any frequently executed shell command.

## Features
- Status bar button that opens all saved custom commands
- Placeholder support (`${input:}`, `${pick:}`, `${env:}`, `${workspaceFolder}`, `${clipboard}`)
- Optional dangerous-command confirmation and preview modal
- Cursor markers that pause execution until you finish a snippet
- Pinned last command button and QuickPick history
- OS-specific filtering and per-command working directories

## Commands
- `priwattGitTerminal.openCommands`
- `priwattGitTerminal.runLastCommand`
- `priwattGitTerminal.finishSnippet`
- `priwattGitTerminal.history`

## Settings (`priwattGitTerminal`)
- `customTerminals`: array of `{ title, command }` objects with optional `cwd`, `reuse`, and `os`
- `customTerminalsButtonLabel`: label for the status bar button
- `cursorSymbol`: marker used to split interactive snippets
- `showPreviewForCustomTerminals`: prompt before execution
- `reuseTerminalByTitle`: reuse terminal windows named after command titles
- `customHistorySize`: number of commands to retain in history
- `confirmDangerousCommands`: ask for confirmation on risky commands
- `pinLastCustomTerminal`: show pinned last-command button
- `pinLastCustomTerminalLabelPrefix`: prefix prepended to pinned label
- `showStatusBar`: toggle the status bar entry entirely

## Development
1. `npm install` (only needed if dependencies are added later; none by default).
2. Launch an Extension Development Host (`F5`).
3. Configure commands under Settings → Priwatt Git Terminal.

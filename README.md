# Dev Script — VS Code Extension

Quickly run package scripts, manage custom terminal snippets with placeholders, convert CSS units, and switch Priwatt WordPress environments from the status bar.

## Highlights
- Dynamic status bar buttons from package.json scripts (with exclusions)
- Tasks API execution with stop/restart and confirmation prompts
- Auto-detect npm/pnpm/yarn/bun and run with the right CLI
- Multi-root aware: first | pick | all modes
- Custom terminal snippets with placeholders, cursor mode, preview, reuse, OS filters, and history
- CSS unit converter (px/rem ↔ vw/vh) via actions and keybindings
- Status bar picker for Priwatt WordPress env blocks inside `.env.local` (toggle comments automatically)

## Activation
- Auto-activates after VS Code startup (no manual trigger needed)
- Also activates when a workspace contains a package.json or any command runs
- Extension status items appear only if `npm install` was run when packaging (`node_modules` must be present)

## Dynamic Scripts
- Enabled by default via `runScript.useDynamicScriptParsing`
- Buttons are generated from `scripts` in package.json
- Sorting prioritizes `dev`, `start`, `build`, then alphabetical
- Uses VS Code Tasks API; prior runs are stopped (with optional confirmation) before re-run
- Watches package.json changes and rebuilds automatically
- Multi-root modes (`runScript.workspaceMode`):
  - `first`: only first folder
  - `pick`: union by name, pick folder on run
  - `all`: show all with `[folder]` prefix

## Package Manager Detection
- Reads `packageManager` field and lockfiles to choose npm/pnpm/yarn/bun
- Commands executed accordingly (e.g., `yarn dev`, `pnpm run build`)

## Custom Terminal Snippets
Define entries in `runScript.customTerminals`:
- Placeholders:
  - `${input:Label}` → prompt for text
  - `${pick:Label|opt1|opt2}` → QuickPick
  - `${env:VAR}` → environment variable
  - `${workspaceFolder}`, `${clipboard}`
- Cursor marker: `runScript.cursorSymbol` (default `<|>`)
  - If present, the part before the marker is inserted without Enter
  - Use command “Custom Terminal: Finish Snippet” to append the tail and execute
- Terminal reuse by title: `runScript.reuseTerminalByTitle` (or per snippet `reuse`)
- Per-snippet `cwd` and `os` filters (win32|darwin|linux)
- Optional preview before run: `runScript.showPreviewForCustomTerminals`
- Dangerous command confirmation: `runScript.confirmDangerousCommands`
  - Prompts on commands like `git reset --hard`, `git clean -fd`, `git push -f`
- History: last N (`runScript.customHistorySize`) entries, command “Custom Terminal: History”
- Pin last command: `runScript.pinLastCustomTerminal` shows a dedicated status bar item

Example:
```
"runScript.customTerminals": [
  { "title": "Git commit", "command": "git commit -m \"<|>\"" },
  { "title": "Docker tag", "command": "docker tag ${input:source} ${input:target}" },
  { "title": "NPM run", "command": "npm run ${pick:script|build|test|lint}" },
  { "title": "Open folder", "command": "code ${workspaceFolder}" },
  { "title": "Echo clip", "command": "echo ${clipboard}" }
]
```

## CSS Unit Conversion
- Convert px/rem ↔ vw/vh with QuickPick flows
- Code actions appear contextually on values; supports multi-selections
- Configure screen list, base font size (rem), and precision

## Commands
- Dynamic scripts run via status bar buttons
- Convert CSS unit to vw/vh: `extension.convertToViewportUnit`
- Convert vw/vh to px/rem: `extension.reverseConvertFromViewportUnit`
- Open Custom Terminal Commands: `extension.openCustomTerminals`
- Run Last Custom Terminal Command: `extension.runLastCustomTerminal`
- Custom Terminal: Finish Snippet: `extension.customTerminal.finishSnippet`
- Custom Terminal: History: `extension.customTerminal.history`
- Select WordPress Environment: `extension.envSwitcher.select`
- Run Script: Stop Running Scripts: `extension.stopRunningScripts`

## Key Settings
- `runScript.useDynamicScriptParsing`: enable dynamic script buttons
- `runScript.workspaceMode`: `first` | `pick` | `all`
- `runScript.excludeScripts`, `runScript.maxDynamicScriptButtons`
- `runScript.askBeforeKill`: confirm before stopping an already running task
- `runScript.cursorSymbol`, `runScript.reuseTerminalByTitle`, `runScript.showPreviewForCustomTerminals`, `runScript.customHistorySize`, `runScript.confirmDangerousCommands`

## Troubleshooting
- Ensure a package.json exists in the workspace (for dynamic scripts)
- Verify Node/PM in PATH for running scripts
- If scripts don’t appear, check exclude list and watch for errors in the Output panel
- Packaging reminder: run `npm install` before creating a VSIX so bundled `node_modules/jsonc-parser` is included
- Environment switcher looks for `.env.local` by default; override via `runScript.envSwitcherFile`

## Development
- Open the folder in VS Code and press F5 to launch an Extension Development Host
- Code resides mainly in `src/scripts.js` and `src/gitShortcuts.js`

Enjoy fast script running and powerful terminal snippets!
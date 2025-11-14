# Priwatt Script Runner

Status bar buttons for the scripts defined in your workspace `package.json`. Detects the package manager automatically and executes commands via the VS Code Tasks API. Includes a stop command for quickly terminating running tasks.

## Features
- Dynamic status bar buttons generated from workspace scripts
- Multi-root awareness (`first`, `pick`, or `all` workspace folders)
- Package manager detection for npm, pnpm, yarn, and bun
- Optional overflow QuickPick when there are more scripts than visible buttons
- Stop-all command for currently running script tasks

## Commands
- `Priwatt Script Runner: Stop Running Scripts` (`priwattScriptRunner.stopRunningScripts`)

## Settings
All settings live under the `priwattScriptRunner` namespace.
- `useDynamicScriptParsing`: enable or disable dynamic buttons
- `workspaceMode`: choose how multi-root workspaces are handled (`first`, `pick`, `all`)
- `excludeScripts`: list of script names to hide
- `maxDynamicScriptButtons`: number of buttons before the `+N` overflow appears
- `reuseTerminalForScripts`: placeholder for future terminal reuse toggles
- `askBeforeKill`: ask for confirmation before terminating running scripts

## Development
1. Run `npm install` inside this folder to install dependencies.
2. Press `F5` in VS Code to launch an Extension Development Host.
3. Open a workspace that contains a `package.json` to see buttons appear.

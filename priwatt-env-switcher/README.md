# Priwatt Env Switcher

Quickly toggle between WordPress environment blocks inside a `.env` file. The extension scans your env file for comment headings (e.g. `# TEST 1`) and comments/uncomments associated variables.

## Features
- Status bar indicator showing the active environment block
- QuickPick menu to switch to any defined block
- Automatic comment toggling so only one set of endpoints stays active
- File watcher that reacts to changes inside the configured env file
- Optional setting to hide the status bar button entirely

## Commands
- `priwattEnvSwitcher.select`: open the environment picker

## Settings (`priwattEnvSwitcher`)
- `envSwitcherFile`: path to the env file (default `.env.local`; supports relative and `~/` paths)
- `showEnvSwitcher`: toggle the status bar button

## Development
1. Launch the Extension Development Host with `F5`.
2. Ensure your workspace contains the configured env file grouped with comment headings.
3. Use the status bar button or the command palette entry to switch environments.

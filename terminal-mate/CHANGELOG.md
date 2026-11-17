# Changelog

All notable changes to the **TerminalMate** extension will be documented in this file.

## [1.5.0] - 2026-11-17

### Added

- Archive: the archive button next to a saved command hides it from the main list without deleting it. `Archive (N)` at the bottom of the list opens archived commands, where each one can be restored or deleted.
- Groups: give commands a `group` and they are shown together under a heading.
- Chains: a saved entry that runs several saved commands one after another and stops at the first one that fails (`Add new chain` in the menu).
- Keyboard shortcuts for single commands through the `terminal-mate.run` command.
- `TerminalMate: Import Commands` and `TerminalMate: Export Commands` to share a command list as a JSON file.
- `terminal-mate.sortCommands` setting: keep your own order, or show the most recent or most used commands first.
- `terminal-mate.dangerousCommandPatterns` setting: choose which commands ask for confirmation.
- The edit button now opens a menu: title, command, working directory, group, duplicate, keyboard shortcut, open in settings.json.

### Fixed

- Re-running a command from History now asks for confirmation on dangerous commands and uses the original working directory.
- `TerminalMate: Open Saved Commands` now works when the status bar button is hidden or no commands are saved yet, and the status bar button is shown before the first command is added.
- The pinned last command now keeps its working directory.
- Repository and homepage links pointed to a folder that no longer exists.

### Changed

- Requires VS Code 1.64 or newer.

## [1.4.1] - 2026-09-30

- Added ↑/↓ buttons next to each saved command to reorder the list without closing the picker.

## [1.4.0] - 2026-09-28

- Added scheduled commands: run a command after a delay (`10m`), at a time (`14:30`), on repeat (`every 15m`), or every day (`daily 09:00`).
- Added `TerminalMate: Schedule Command` and `TerminalMate: Scheduled Commands`, plus a clock button next to each saved command.
- Added a status bar countdown to the next scheduled run. Schedules are saved per workspace and missed one-time runs are offered after a restart.

## [1.3.0] - 2026-07-07

- Commands are now always saved to global settings by default.
- Added `terminal-mate.saveCommandsToWorkspace` setting (checkbox, default: off) — when enabled, new and edited commands are saved to workspace settings instead of global.

## [1.2.0] - 2026-05-28

- Added "Delete" button to the command list for quick removal of unwanted snippets.
- Added "Add new command" option directly within the "Open Saved Commands" menu.
- Added inline Edit button for each saved command to easily modify titles and snippets.
- Improved command management by allowing workspace-specific or global persistence when adding/editing.

## [1.0.0] - 2026-02-05

- Initial release of TerminalMate.
- Support for custom terminal snippets with placeholders.
- Status bar menu and pinned last-command button.
- Command history and dangerous-command protection.
- Cross-platform OS filtering.
- Interactive snippets with manual cursor markers.

# Changelog

All notable changes to the **TerminalMate** extension will be documented in this file.

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

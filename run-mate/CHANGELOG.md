# Changelog

All notable changes to the **RunMate - Script Runner** extension will be documented in this file.

## [1.4.0] - 2026-06-25

- **Dedicated stop button**: when a script is running the status bar button switches to a `$(stop-circle)` stop button (highlighted in warning colour). Clicking it stops the script. Once the task ends the button reverts to the normal run icon — no more toggle-on-click behaviour.

## [1.3.0] - 2026-06-18

- **Favorites in status bar**: starred scripts now replace the default priority-based buttons. If you have 2 button slots and star `dev` + `check`, those two appear in the bar instead of the top-2 by script order. Remaining free slots are still filled by priority.
- **Picker-only mode** (`pickerOnly: true`): show a single `$(list-unordered) Scripts` button in the status bar. Clicking it opens the full script picker where favorites appear first. Useful when you prefer to keep the bar minimal.

## [1.2.1] - 2026-06-18

- **Fix Yarn Berry command**: projects with `.yarnrc.yml` or `packageManager: yarn@2+` are now detected as `yarn-berry` and executed via `corepack yarn run <script>` instead of the system `yarn` binary (which on Ubuntu/Debian may be the unrelated `cmdtest` package, version `0.32+git`).

## [1.2.0] - 2026-06-18

- **Favorites / Stars**: scripts in the command picker can now be starred. Starred scripts sort to the top and show a filled star icon. Click the star button on any item to toggle its favorite state without closing the picker.
- **Skip single-repo picker**: in `pick` workspace mode, if a script exists in only one folder the folder-selection step is skipped and the script runs immediately.
- **Yarn Berry (PnP) support**: dependency install check now also looks for `.yarn/install-state.gz` and `.pnp.cjs` so Yarn Berry PnP projects correctly trigger `yarn install` before the first run.

## [1.1.1] - 2026-06-18

- Fixed Yarn Berry (v2+) support: dependency install detection now checks `.yarn/install-state.gz` and `.pnp.cjs` in addition to `node_modules`, so PnP-mode projects correctly trigger `yarn install` before the first script run.

## [1.1.0] - 2026-02-10

- Added **Auto-Install Dependencies** feature.
- New setting `alwaysInstallDependencies`: Always run install before scripts.
- New setting `autoInstallMissingDependencies`: Automatically install if `node_modules` is missing (default: true).
- Improved command chaining for script execution.

## [1.0.5] - 2026-02-08

- Fixed starting on remote wsl

## [1.0.0] - 2026-02-05

- Initial release of RunMate - Script Runner.
- Support for auto-detecting npm, pnpm, yarn, and bun.
- Dynamic status bar buttons for package.json scripts.
- Smart script ordering and overflow menu support.
- Multi-root workspace support.
- NVM support via `.nvmrc` auto-detection.

# Changelog

All notable changes to the **RunMate - Script Runner** extension will be documented in this file.

## [1.5.0] - 2026-11-17

The biggest update so far. In short: RunMate now understands repositories with several projects, lets you arrange the script list the way you like, works in every common shell on Windows, macOS and Linux, and helps you install what is missing.

You do not have to change anything after updating. Your stars are kept.

### New: several projects in one repository

- **A button per project.** If your repository has projects in subfolders (`apps/web`, `packages/ui`, ...), the status bar shows one button for each. Click a project to see only its scripts. They run from that project's folder.
- **Monorepos are read properly.** RunMate reads `workspaces` from `package.json` (npm, Yarn, Bun) and `pnpm-workspace.yaml`, so it finds every package, however deep it is.
- Settings for this: `statusBarLayout`, `nestedProjects`, `nestedProjectsMaxDepth`, `nestedProjectsExclude`, `maxProjectButtons`.

### New: arrange the script list

Open the list with `Ctrl+Alt+Q` or the `...` button. Every row now has buttons:

- **Arrows** move a script up or down. The status bar follows the same order.
- **Eye** hides a script. Hidden scripts go to a **Hidden** section at the bottom, where you can bring them back.
- **Star** marks a favorite, as before.
- **Gear** at the top changes the most used settings (number of buttons, layout, side, shell, and more) without opening VS Code's Settings.
- The `...` button is now always visible, so you can always reach the list.

### New: more ways to run

- **Run with arguments.** The terminal button on a row lets you add arguments for one run, for example `--watch`. The last five per script are remembered.
- **Run in another shell.** The same button runs a script once in a different shell. The `shell` setting changes it for all scripts. Supported: PowerShell 7, Windows PowerShell, Command Prompt, Git Bash, bash, zsh, fish, sh.
- **Groups.** Put several scripts in a group (for example `dev` of the frontend and `dev` of the backend) and start or stop them with one click. Command: **RunMate: New Group**.
- **Run Last Script Again.** A new command that repeats your last run with the same arguments and shell. Give it a keyboard shortcut if you use it often.
- **Stop Running Scripts.** A new command that stops everything RunMate started.

### New: help when something goes wrong

- **The port is taken.** Before a dev server starts, RunMate checks that its port is free. If an old server still holds it, RunMate tells you which program it is and offers to stop it. Settings: `checkPorts`, and `scriptPorts` for scripts whose port RunMate cannot work out.
- **A script failed.** Its button turns red, and a message offers **Run again** and **Show terminal**. Stopping a script yourself is not reported. Setting: `notifyOnFailure`.

### New: env files

- **Run a script with an env file.** The terminal button on a row now has **Run with an env file...**: pick `.env.local`, `.env.staging` or any other env file of the project. RunMate remembers the choice for that script and shows it on the row.
- **One env file for all scripts.** The new `envFile` setting loads a file for every script of every project that has it.

### New: for teams and newcomers

- **Share a group with your team.** The people icon on a group's row moves the group into `.vscode/settings.json` (the new `groups` setting). Commit the file and everyone gets the same button.
- **A getting started guide inside VS Code.** Five short steps. Open it with **RunMate: Open the Getting Started Guide**, or from the gear menu of the script list.
- **Pictures in the README**, taken from a real VS Code window.

### New: not only package.json

- RunMate now also shows **Deno tasks** (`deno.json`), **Makefile targets** and **just recipes** (`justfile`). Choose what you want to see with the `scriptSources` setting.

### New: Node.js versions and missing tools

- **More version managers.** fnm and Volta are supported next to nvm and nvm for Windows (`nodeVersionManager` setting).
- **More version files.** The Node version is read from `.nvmrc`, `.node-version`, `.tool-versions`, `volta.node` and now also from `engines.node` in `package.json`. Files in parent folders count too.
- **Help with what is missing** (`preflightChecks` setting). If the Node version, a version manager or the package manager is not installed, RunMate offers to install it and then runs your script. It always asks first.

### Fixed

- **Windows PowerShell 5.1:** scripts failed when the project had a `.nvmrc` or needed an install first, because the command used `&&`, which that shell does not understand. Every shell now gets a command in its own syntax.
- **Node was switched on every run**, even when the right version was already active. On Windows this could ask for administrator permission each time. Now it switches only when needed.
- **nvm for Windows** did not accept versions written as `v20`, `20` or `lts/*`. Fixed.
- **nvm installed in another place** (the `NVM_DIR` variable, Homebrew) was not found. Fixed.
- **Projects in subfolders** ran with npm even when the repository uses pnpm, Yarn or Bun, and reinstalled dependencies on every run. Fixed.
- **Projects without dependencies** ran install on every start. Fixed.
- **`maxDynamicScriptButtons: 0`** was treated as 8. It now really shows no script buttons.
- **The `...` button** showed the total number of scripts instead of how many have no button.
- **Scripts with similar names** (`build:prod` and `build.prod`) clashed, and the buttons after them did not appear.
- **Fast changes were lost:** saving `package.json` twice quickly, or changing a setting while buttons were being built, could leave old buttons on screen.
- **`reuseTerminalForScripts` and `askBeforeKill`** were in the settings but did nothing. They work now.
- **With Volta installed**, a missing pnpm or Yarn was reported as installed.
- **Yarn 2+** no longer needs corepack when a `yarn` command is available.
- Script names with special characters are passed to the shell correctly.

### Changed

- **Stars, hidden scripts, order and groups are saved per workspace.** Before, a star applied in every repository. Your existing stars stay until you change them in a workspace.
- Needs VS Code 1.75 or newer.
- `pickerOnly` is replaced by `statusBarLayout: "picker"`. The old setting still works.
- The README and all setting descriptions were rewritten in plain language. The README had setting names with a wrong prefix; the right one is `run-mate-script-runner.`

## [1.4.4] - 2026-07-20

- **Fix `.nvmrc` scripts on macOS/Linux with a non-bash default shell**: the nvm-sourcing command (`. ~/.nvm/nvm.sh && nvm use && ...`) is bash syntax and failed to parse when the user's default integrated terminal shell was fish (or another non-POSIX-sh shell), e.g. `source: Error ... Unexpected ')'`. RunMate now runs that command through `bash` explicitly instead of the configured default shell.

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

# Changelog

All notable changes to the **RunMate - Script Runner** extension will be documented in this file.

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

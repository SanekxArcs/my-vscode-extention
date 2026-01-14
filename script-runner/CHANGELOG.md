# Changelog

All notable changes to the RunMate extension will be documented in this file.

## [1.0.0] - 2024-12-04

### Added
- Initial release of RunMate
- Dynamic status bar buttons for package.json scripts
- Auto-detection of npm, pnpm, yarn, and bun package managers
- Multi-root workspace support with three modes (first, pick, all)
- Quick menu access with Ctrl+Alt+Q hotkey
- Stop all running scripts command
- Customizable script exclusion and ordering
- NVM (.nvmrc) support for Node version management
- Ask-before-kill confirmation for re-running scripts
- Terminal reuse for dedicated script execution
- Comprehensive configuration options

### Features
- **Status Bar Integration** – Scripts appear as clickable buttons in the status bar
- **Overflow Menu** – Collapse excess scripts into a +N menu
- **Smart Ordering** – Prioritize common scripts (dev, start, build, test, lint)
- **Quick Access** – Hotkey (Ctrl+Alt+Q) for fast script selection
- **Multi-Workspace** – Handle multiple package.json files
- **Error Handling** – Clear error messages for invalid package.json or failed script runs
- **Terminal Management** – Dedicated terminal per script with reuse option

### Configuration Options
- `runmate.useDynamicScriptParsing` – Enable/disable dynamic buttons
- `runmate.workspaceMode` – Choose workspace handling strategy
- `runmate.excludeScripts` – Hide specific scripts
- `runmate.maxDynamicScriptButtons` – Control button overflow threshold
- `runmate.scriptOrder` – Customize script display order
- `runmate.reuseTerminalForScripts` – Terminal reuse toggle
- `runmate.askBeforeKill` – Confirm before stopping scripts

---

## Future Roadmap (Planned)

### [1.1.0] - Planned
- [ ] Script history/recent scripts feature
- [ ] Custom script groups/categories
- [ ] Environment variable picker for scripts
- [ ] Script execution time tracking
- [ ] Dark theme icon support
- [ ] Settings UI panel

### [1.2.0] - Planned
- [ ] Script templates
- [ ] Integration with task runners (gulp, grunt)
- [ ] Script dependency visualization
- [ ] Shell command completion
- [ ] Output filtering/highlighting

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/):
- **MAJOR** (1.0.0) – Significant features or breaking changes
- **MINOR** (1.1.0) – New features, backwards compatible
- **PATCH** (1.0.1) – Bug fixes

---

## How to Report Issues

Found a bug or want to request a feature?

1. Check [existing issues](https://github.com/SanekxArcs/runmate/issues)
2. [Create a new issue](https://github.com/SanekxArcs/runmate/issues/new) with:
   - Clear title and description
   - Steps to reproduce (for bugs)
   - Expected vs. actual behavior
   - VS Code version and extension version
   - Your OS and package manager

---

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

**Last Updated:** December 4, 2024

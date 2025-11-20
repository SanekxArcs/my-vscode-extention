#  Extensions

This repository now houses four fully independent VS Code extensions. Each lives in its own folder, can be packaged separately, and focuses on a single responsibility.

## Extensions
- **script-runner** — dynamic status bar buttons for workspace `package.json` scripts plus a “stop all” command.
- **viewport-converter** — px/rem ↔ vw/vh conversions, Tailwind unit cycling, and screen presets with status bar controls.
- **git-terminal** — saved terminal snippets, dangerous-command confirmation, QuickPick history, and pinned last-command button.
- **env-switcher** — status bar picker that toggles WordPress endpoint blocks in `.env` files.

Each extension contains its own `package.json`, activation commands, configuration namespace, and README explaining usage and development steps.

## Getting Started
1. Open the desired extension folder (e.g., `script-runner`) in VS Code.
2. Run `npm install` if the extension declares dependencies.
3. Press `F5` to launch an Extension Development Host and test the extension in isolation.
4. Package with `vsce package` or `npm run package` once you are ready to distribute.

## Repository Layout
```
script-runner/
viewport-converter/
git-terminal/
env-switcher/
.github/copilot-instructions.md
README.md (this file)
```

## Notes
- The legacy combined extension has been split; install only the modules you need.
- Settings were renamed to match each extension’s namespace (`scriptRunner`, `viewportConverter`, `gitTerminal`, `envSwitcher`).
- Status bar widgets in each extension can be hidden via their respective `show*` toggle setting.

Enjoy fast script running and powerful terminal snippets!
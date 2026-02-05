# RunMate - Script Runner

> Quick script runner with intelligent status bar buttons for package.json scripts

RunMate is a lightweight VS Code extension that brings your npm, pnpm, yarn, and bun scripts right to your fingertips. Forget about digging through your `package.json` or typing commands in the terminal – just click a button in the status bar!

## ✨ Features

- **Dynamic Status Bar Buttons** – Automatically generates buttons from your `package.json` scripts
- **Multi-Package Manager Support** – Detects and supports npm, pnpm, yarn, and bun automatically
- **Smart Script Ordering** – Prioritize common scripts (dev, start, build, test, lint) or customize your own
- **Overflow Menu** – More scripts than buttons? No problem! Excess scripts collapse into an overflow menu
- **Quick Access via Hotkey** – Press `Ctrl+Alt+Q` to instantly see all available scripts
- **Multi-Root Workspace Support** – Handle multiple workspace folders with ease
- **Stop Command** – Quickly terminate running scripts from the command palette
- **NVM Support** – Automatically uses `.nvmrc` when available for Node version management
- **Smart Configuration** – Exclude specific scripts, control button limits, and customize behavior

## 🚀 Quick Start

1. Install RunMate from the VS Code Marketplace
2. Open any folder with a `package.json` file
3. Watch as RunMate creates status bar buttons for your scripts
4. Click any button to run that script – the output appears in VS Code's integrated terminal
5. Use `Ctrl+Alt+Q` to see all available scripts in a quick menu

## 📋 Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| `RunMate: Show All Scripts` | `Ctrl+Alt+Q` | Open quick menu with all scripts |
| `RunMate: Stop Running Scripts` | – | Stop all currently running script tasks |

## ⚙️ Configuration

All settings are under the `runmate` namespace. Customize RunMate to fit your workflow:

### `runmate.useDynamicScriptParsing`
- **Type:** `boolean`
- **Default:** `true`
- Enable or disable dynamic status bar buttons

### `runmate.workspaceMode`
- **Type:** `string` (`first` | `pick` | `all`)
- **Default:** `first`
- How to handle multi-root workspaces:
  - `first` – Use scripts from the first workspace folder only
  - `pick` – Show unique scripts from all folders, pick folder on run
  - `all` – Show scripts from all folders with folder name labels

### `runmate.excludeScripts`
- **Type:** `array` of strings
- **Default:** `["test", "postinstall", "preinstall"]`
- List of script names to hide from the status bar

### `runmate.maxDynamicScriptButtons`
- **Type:** `number`
- **Default:** `8`
- **Minimum:** `0`
- Maximum number of script buttons before collapsing into overflow menu

### `runmate.scriptOrder`
- **Type:** `array` of strings
- **Default:** `["dev", "start", "build", "test", "lint"]`
- Priority order for displaying scripts – scripts here appear first

### `runmate.reuseTerminalForScripts`
- **Type:** `boolean`
- **Default:** `true`
- Reuse dedicated terminals per script instead of creating new ones each run

### `runmate.askBeforeKill`
- **Type:** `boolean`
- **Default:** `true`
- Ask for confirmation before stopping a running script when re-running from the status bar

## 🎯 Use Cases

### Development Teams
- Quickly run common scripts without memorizing names
- Organized buttons make onboarding faster
- Multi-workspace support handles monorepos

### Individual Developers
- One-click access to dev, build, and test scripts
- Keyboard shortcut for power users
- Automatic package manager detection means one setup for all projects

### Monorepo Environments
- Work with multiple `package.json` files across workspaces
- `pick` mode makes it easy to run scripts in specific folders
- Custom configuration per workspace via `.vscode/settings.json`

## 🔧 Advanced Configuration

Create a `.vscode/settings.json` in your workspace root:

```json
{
  "runmate.workspaceMode": "all",
  "runmate.maxDynamicScriptButtons": 10,
  "runmate.excludeScripts": ["test", "postinstall"],
  "runmate.scriptOrder": ["dev", "build", "start", "test"]
}
```

## 🐛 Troubleshooting

### Scripts not appearing?
- Verify your `package.json` is valid JSON
- Check if the script name is in `excludeScripts`
- Ensure `useDynamicScriptParsing` is enabled in settings

### Wrong package manager detected?
- RunMate detects based on lock files (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `package-lock.json`)
- Specify manually with `packageManager` field in `package.json`:
  ```json
  {
    "packageManager": "pnpm@8.0.0"
  }
  ```

### Terminal shows wrong directory?
- RunMate runs scripts in the folder containing the script
- For multi-root workspaces, ensure the correct folder is selected

## 🤝 Contributing

Found a bug or have a feature request? Visit the [GitHub repository](https://github.com/SanekxArcs/runmate).

## 📄 License

MIT License – feel free to use RunMate in your projects!

## 💡 Tips & Tricks

- **Power User Shortcut:** Use `Ctrl+Alt+Q` multiple times to quickly cycle through different script selections
- **Organize Your Scripts:** Use meaningful names in `package.json` and leverage `scriptOrder` to organize buttons
- **Team Configuration:** Commit `.vscode/settings.json` to ensure all team members have the same script buttons
- **Monorepo Magic:** Use workspace folders with root `package.json` and `runmate.workspaceMode: "all"` for seamless monorepo support

---

**Happy scripting! 🎉**

# Dev Script — VS Code Extension

A productivity-focused VS Code extension that helps you quickly run common npm scripts from the status bar, format the active file with Prettier, and convert CSS units between px/rem and vw/vh with handy code actions, context menu items, and keybindings.

## Highlights
- Status bar buttons to run Dev, Storybook, and Prettier commands.
- Optional dynamic parsing of your workspace package.json to create status bar buttons for all scripts (with exclusions).
- CSS unit converter:
  - px/rem → vw/vh
  - vw/vh → px/rem
  - Works via selection or cursor position, supports multi-selections.
  - Code actions appear contextually when the cursor is on a value.
- Editor context menu entries and convenient keybindings.

## Requirements
- VS Code: ^1.60.0
- Node.js and npm available in your PATH (for running scripts and npx prettier).
- A workspace with a package.json (the extension auto-activates when one is present).
- For best Prettier results, ensure your project has a Prettier configuration, or rely on npx defaults.

## Activation
The extension activates when:
- Your workspace contains a package.json, or
- You invoke any of the provided commands (see Commands section).

## Commands
- Run Dev Script: extension.runDevScript
- Run Storybook: extension.runStorybook
- Run Prettier on Active File: extension.runPrettierActiveFile
- Check Prettier on Active File: extension.runPrettierCheckActiveFile
- Convert CSS unit to vw/vh: extension.convertToViewportUnit
- Convert vw/vh to px/rem: extension.reverseConvertFromViewportUnit

You can run these via the Command Palette (Ctrl/Cmd+Shift+P) by typing the command title.

## Status Bar Buttons
- Run Dev ("$(play) Run Dev"): Runs npm run dev in a new terminal.
  - Special handling: If your dev script contains "npm run node-version:check", the extension temporarily replaces the dev script with "next dev" to bypass the check, runs it, and restores the original line after ~10 seconds.
- Run SB ("$(book) Run SB"): Runs npm run storybook.
- Prettier (AF) ("$(sparkle) Prettier (AF)"): Runs npx prettier --write on the active file.
- Check ("$(check) Check"): Runs npx prettier --check on the active file.

Visibility of these buttons can be customized via settings. If dynamic parsing is enabled (see below), built-in buttons are hidden and replaced with automatically generated ones.

## Dynamic Script Parsing (Optional)
When enabled, the extension scans your workspace package.json and creates a status bar button for each script (excluding those you choose to exclude). Scripts are sorted so that common ones like dev, start, and build appear first, then the rest alphabetically.
- Icons try to match intent: dev → play, build → gear, start → rocket, others → terminal.
- Clicking a button runs npm run <script> in a new terminal.

## CSS Unit Conversion
Convert CSS values between px/rem and vw/vh with a guided Quick Pick flow.
- px/rem → vw/vh: Choose vw or vh, then pick a target screen size (WIDTHxHEIGHT), and the extension will convert selected values or the value under your cursor.
- vw/vh → px/rem: Choose source unit (vw/vh), pick the screen size, then choose output unit (px/rem).
- Multi-selections are supported, and trailing zeros are trimmed for clean results.
- Screen list, base font size (for rem), and precision are all configurable.

Contextual Code Actions will appear when your cursor is on a value like 16px, 1.5rem, 10vw, or 25vh.

## Editor Context Menu
In the editor context menu (right-click in code), you’ll find:
- Convert CSS unit to vw/vh
- Convert vw/vh to px/rem

## Keybindings
- Convert to vw/vh: Ctrl+Alt+V (macOS: Cmd+Alt+V)
- Convert vw/vh to px/rem: Ctrl+Alt+Shift+V (macOS: Cmd+Alt+Shift+V)

## Settings
All settings live under the runScript.* namespace.

- runScript.useDynamicScriptParsing (boolean, default: false)
  - Enable dynamic parsing of all package.json scripts as status bar buttons.
  - Disables the custom Dev/Storybook/Prettier buttons when enabled.

- runScript.showDevButton (boolean, default: true)
  - Show the "Run Dev" status bar button (only when dynamic parsing is off).

- runScript.showStorybookButton (boolean, default: true)
  - Show the "Run Storybook" status bar button (only when dynamic parsing is off).

- runScript.showPrettierButton (boolean, default: true)
  - Show the "Prettier (AF)" status bar button (only when dynamic parsing is off).

- runScript.showPrettierCheckButton (boolean, default: true)
  - Show the "Check Prettier" status bar button (only when dynamic parsing is off).

- runScript.excludeScripts (array of strings, default: ["test", "postinstall", "preinstall"])
  - Scripts to exclude when dynamic parsing is enabled.

- runScript.viewportScreens (array of strings, default: common sizes like "1440x900", "1920x1080", etc.)
  - List of target screens in WIDTHxHEIGHT format for conversions. You can add/remove entries.

- runScript.baseFontSize (number, default: 16)
  - Base font size in pixels used for rem ↔ px conversion (1rem = baseFontSize px).

- runScript.viewportPrecision (number, default: 4)
  - Number of decimal places to keep when converting to vw/vh.

- runScript.lastUsedViewportUnit (string, enum: "vw" | "vh", default: "vw")
  - Tracks your last used viewport unit, updated automatically after conversions.

- runScript.lastUsedScreen (string, default: "1440x900")
  - Tracks your last used screen size, updated automatically after conversions.

- runScript.defaultOutputUnit (string, enum: "px" | "rem", default: "px")
  - Default unit when converting vw/vh back to px/rem.

## Usage Examples
- Run Dev: Click the "Run Dev" status bar button or run "Run Dev Script" from the Command Palette.
- Run Storybook: Click the "Run SB" status bar button or run "Run Storybook".
- Format Active File: Click "Prettier (AF)" or run "Run Prettier on Active File".
- Check Active File with Prettier: Click "Check" or run "Check Prettier on Active File".
- Convert 16px to vw: Select "16px" (or place cursor on it), run "Convert CSS unit to vw/vh", pick "vw", choose a screen like 1440x900.
- Convert 10vw to rem: Select "10vw" (or place cursor on it), run "Convert vw/vh to px/rem", choose the screen and output unit "rem".

## Notes and Limitations
- The Dev script helper temporarily edits your package.json when it detects "npm run node-version:check" in the dev script. The original line is restored automatically after ~10 seconds.
- Conversions operate on a single numeric token at a time; complex expressions (e.g., calc()) are not parsed.
- Dynamic parsing only appears when a package.json is present in the first workspace folder.

## Troubleshooting
- "No workspace folder found" / "package.json not found": Open a folder containing a package.json.
- Prettier command errors: Ensure Node.js/npm is installed and accessible, and that npx can run Prettier. Optionally add Prettier to your devDependencies.
- "No screens configured": Add entries to runScript.viewportScreens in settings, formatted as WIDTHxHEIGHT (e.g., 1440x900).

## Local Development
- Open this folder in VS Code and press F5 to launch an Extension Development Host to test the extension.
- Inspect and tweak behavior in extension.js and package.json.

---
Enjoy faster script running and effortless CSS unit conversions!
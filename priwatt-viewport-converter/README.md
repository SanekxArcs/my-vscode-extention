# Priwatt Viewport Converter

Convert CSS pixel/rem values into viewport units and back again directly from VS Code. Includes Tailwind utility cycling, status bar controls for common screen sizes, and QuickPick workflows for fast conversions.

## Features
- Convert selections or cursor values between px/rem and vw/vh
- Reverse conversion from viewport units back to px/rem with configurable precision
- Tailwind utility cycle (px → rem → tailwind unit → px)
- Status bar overview of current screen/base font/precision with quick configuration pickers
- Optional QuickConvert status button (toggled via settings)
- Code actions for in-place refactors across CSS and JavaScript files

## Commands
- `priwattViewport.convertToViewportUnit`
- `priwattViewport.reverseConvertFromViewportUnit`
- `priwattViewport.convertHereQuick`
- `priwattViewport.convertCycleVW`
- `priwattViewport.convertCycleVH`
- `priwattViewport.cycleViewportScreen`
- `priwattViewport.viewportSettingsQuick`
- `priwattViewport.cycleTailwindUnit`

## Settings (`priwattViewport`)
- `viewportScreens`: list of WIDTHxHEIGHT entries to convert against
- `baseFontSize`: base font size for rem ↔ px conversions
- `viewportPrecision`: decimal precision for viewport conversions
- `defaultOutputUnit`: default when reversing viewport units (`px` or `rem`)
- `autoDetectViewportAxis`: infer vw/vh from property name when possible
- `lastUsedViewportUnit` / `lastUsedScreen`: persisted via commands
- `showViewportStatusBar`: toggle visibility of the status bar controls

## Development
1. Run `npm install` in this folder if you need additional dependencies (none by default).
2. Launch the Extension Development Host with `F5` from VS Code.
3. Trigger any converter command (Command Palette or keybindings) inside a file containing CSS values.

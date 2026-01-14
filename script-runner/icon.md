# Icon Placement Guide for RunMate

## Requirements

- **Filename:** `icon.png`
- **Size:** 128x128 pixels
- **Format:** PNG with transparency
- **Location:** Place in the root of the `script-runner` directory (same level as `package.json`)
- **Color Scheme:** Works best with recognizable symbols like:
  - Gears (⚙️) – suggests automation/scripting
  - Play buttons (▶️) – suggests execution
  - Terminal/console symbols – direct association with npm scripts
  - Lightning bolts ⚡ – suggests speed/quick access
  - Running figure 🏃 – suggests the "RunMate" name

## Current Status

⚠️ **TODO:** Replace this placeholder text with an actual icon image.

The `icon.png` file is referenced in `package.json`:
```json
"icon": "icon.png"
```

This icon will appear in:
- VS Code Extensions Marketplace
- VS Code Extensions sidebar
- Quick search results
- Extension store listings

## Creating Your Icon

### Option 1: Use a Design Tool
- Figma (free tier available)
- Adobe XD
- Inkscape (free, open-source)
- GIMP (free, open-source)

### Option 2: Use Icon Generators
- [Canva](https://www.canva.com) – Drag-and-drop design
- [Looka](https://www.looka.com) – AI-powered logo design
- [Logo.com](https://www.logo.com) – Quick logo generator

### Option 3: Find Open Source Icons
- [Noun Project](https://thenounproject.com)
- [Flaticon](https://www.flaticon.com)
- [Icons8](https://icons8.com)
- [Feather Icons](https://feathericons.com)
- [Material Icons](https://fonts.google.com/icons)

## Icon Design Tips

1. **Keep It Simple** – Avoid excessive detail at 128x128 px
2. **Use Contrast** – Ensure it stands out on both light and dark backgrounds
3. **Stay On-Brand** – Consider your extension's purpose (RunMate = quick script execution)
4. **Add Transparency** – PNG with alpha channel blends better
5. **Test at Scale** – Verify readability at 128x128 and smaller sizes

## Example Icon Concepts for RunMate

- **Gear with play button overlay** – Automation meets execution
- **Terminal with fast badge** – Script execution emphasis
- **Rocket with script symbols** – Speed and scripting combined
- **Lightning bolt in circle** – Quick access/speed

## Publishing Reminder

Before publishing to the marketplace:
1. Ensure `icon.png` is exactly 128x128 pixels
2. Verify it's in the root directory
3. Test by running `vsce package` locally
4. Check that the icon appears in the `.vsix` file

---

**Once you have your icon:** Replace this file with your actual `icon.png` and delete this guide text, or keep both files side-by-side.

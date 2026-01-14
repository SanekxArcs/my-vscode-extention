# 🚀 RunMate Quick Reference – What's Changed

## Summary of Renaming

| Aspect | Before | After |
|--------|--------|-------|
| **Extension Name** | script-runner | runmate |
| **Display Name** | Script Runner | RunMate |
| **Publisher** | local | SanekxArcs |
| **Version** | 0.0.1 | 1.0.0 |
| **Command Prefix** | scriptRunner | runmate |
| **Config Namespace** | scriptRunner | runmate |
| **Task Type** | scriptRunner | runmate |

## Configuration Examples

### Old (Before)
```json
{
  "scriptRunner.useDynamicScriptParsing": true,
  "scriptRunner.workspaceMode": "first",
  "scriptRunner.excludeScripts": ["test", "postinstall"]
}
```

### New (After)
```json
{
  "runmate.useDynamicScriptParsing": true,
  "runmate.workspaceMode": "first",
  "runmate.excludeScripts": ["test", "postinstall"]
}
```

## Commands

### Old
- `scriptRunner.stopRunningScripts`
- `scriptRunner.showAllScripts`

### New
- `runmate.stopRunningScripts`
- `runmate.showAllScripts`

### Hotkey (Same)
- **Ctrl+Alt+Q** – Show all scripts

## File Reference

### Marketplace Documentation
- **README.md** – User-facing documentation
- **CHANGELOG.md** – Version history and roadmap
- **MARKETPLACE.md** – Publishing guide (for you)
- **LICENSE** – MIT License
- **icon.md** – Icon placement guide (128x128 PNG)

### Configuration Files
- **.vscodeignore** – Tells marketplace what to exclude
- **.gitignore** – Git version control settings
- **package.json** – All marketplace metadata

### Source Code
- **extension.js** – Entry point (unchanged)
- **src/config.js** – Configuration handler (updated)
- **src/scripts.js** – Main logic (updated)

## Where to Add Your Icon

```
script-runner/
├── icon.png            ← Place your 128x128 PNG icon here
├── package.json        ← Already references it
└── README.md
```

## Marketplace Links

When ready to publish:
- **Marketplace:** https://marketplace.visualstudio.com
- **Publisher Settings:** https://marketplace.visualstudio.com/manage
- **Personal Access Tokens:** https://dev.azure.com (under User Settings)

## Publishing Command

```bash
cd script-runner
vsce publish --pat YOUR_PERSONAL_ACCESS_TOKEN
```

## Settings Format (All Updated)

```javascript
// runmate.useDynamicScriptParsing (boolean, default: true)
// runmate.workspaceMode (string, default: "first")
// runmate.excludeScripts (array, default: ["test", "postinstall", "preinstall"])
// runmate.maxDynamicScriptButtons (number, default: 8)
// runmate.scriptOrder (array, default: ["dev", "start", "build", "test", "lint"])
// runmate.reuseTerminalForScripts (boolean, default: true)
// runmate.askBeforeKill (boolean, default: true)
```

## All Changes Summary

✅ **14 files created/updated:**
1. package.json – Full marketplace config
2. README.md – Professional documentation
3. CHANGELOG.md – Version history
4. MARKETPLACE.md – Publishing guide
5. LICENSE – MIT license
6. .gitignore – Git settings
7. .vscodeignore – Marketplace packaging
8. icon.md – Icon setup guide
9. MARKETPLACE_PREP.md – Preparation summary
10. config.js – Namespace updated
11. scripts.js – All references updated
12. extension.js – No changes needed
13. README (original) – Kept backup version
14. This file – Quick reference

## Next Steps

1. ✅ Rename complete – **DONE**
2. 🎨 Add icon (128x128 PNG) – **TODO**
3. 🧪 Test locally (npm install, F5) – **TODO**
4. 📦 Create marketplace account – **TODO**
5. 🔑 Generate publishing token – **TODO**
6. 🚀 Publish with vsce – **TODO**

---

**You're ready to take RunMate to the VS Code Marketplace!** 🎉

# TerminalMate Marketplace Preparation Guide

This document outlines the final steps to publish **TerminalMate** to the Visual Studio Code Marketplace.

## 📋 Checklist

- [x] **package.json**: Verified metadata (name: terminal-mate, display: TerminalMate).
- [x] **README.md**: Professional documentation.
- [x] **CHANGELOG.md**: History entry created.
- [x] **LICENSE**: MIT License added.
- [ ] **Icons**: `icon-128.png` must be present in the root folder.

## 🚀 Publishing Steps

### 1. Install `vsce`
If you haven't already, install the Visual Studio Code Extension Manager utility:
```bash
npm install -g @vscode/vsce
```

### 2. Login to Marketplace
Use your Personal Access Token (PAT).
```bash
vsce login SanekxArcs
```

### 3. Package the Extension
Run this command from the `git-terminal` directory:
```bash
vsce package
```

### 4. Publish
```bash
vsce publish
```

## 🛠️ Local Testing
Before publishing:
1. Open the `git-terminal` folder in VS Code.
2. Press `F5` to open the "Extension Development Host".
3. Add a sample command in `terminal-mate.customTerminals`.
4. Verify the **TM** button appears and works.

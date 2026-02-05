# VC-Mate Marketplace Preparation Guide

This document outlines the final steps to publish **VC-Mate** to the Visual Studio Code Marketplace.

## 📋 Checklist

- [x] **package.json**: Verified metadata (name: vc-mate, display: VC-Mate).
- [x] **README.md**: Professional documentation updated.
- [x] **CHANGELOG.md**: History entry created.
- [x] **LICENSE**: Updated to 2026.
- [x] **Icons**: `vp-converter.png` is assigned.

## 🚀 Publishing Steps

### 1. Install `vsce`
```bash
npm install -g @vscode/vsce
```

### 2. Login to Marketplace
```bash
vsce login SanekxArcs
```

### 3. Package the Extension
```bash
vsce package
```

### 4. Publish
```bash
vsce publish
```

## 🛠️ Local Testing
1. Open the `viewport-converter` folder in VS Code.
2. Press `F5` to open the "Extension Development Host".
3. Check status bar controls and `Ctrl+Alt+V` shortcuts.

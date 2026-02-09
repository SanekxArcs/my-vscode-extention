# VC-Mate: The Professional Viewport Converter

**VC-Mate** is a high-productivity VS Code extension designed for modern web developers. It eliminates the friction of manually calculating viewport units (\w\/\h\) by providing instant, context-aware conversions directly within your editor.

---

## 🚀 Speed Up Your Workflow

Whether you're working with pixel-perfect designs or responsive layouts, **VC-Mate** handles the math so you can focus on the code.

### ✨ Key Features
- **Instant Conversion**: Convert \px\ or \em\ to \w\/\h\ using \Ctrl+Alt+V\.
- **Smart Reverse Engine**: Convert viewport units back to \px\ or \em\ with customizable precision.
- **Tailwind-Ready**: Seamlessly toggle between plain units and Tailwind's arbitrary value syntax (e.g., \32px\ → \[2vw]\).
- **One-Key Cycling**: 
  - \Alt+Z\: Cycle units (\px\ → \em\ → \	ailwind\ → \px\).
  - \Alt+V\ / \Alt+H\: Instant dimension scaling for width/height.
- **Auto-Axis Detection**: Smartly infers whether to use \w\ or \h\ based on the CSS property name (e.g., \width\ vs \height\).
- **Interactive Status Bar**: 
  - **Quick Screen Switch**: Click to cycle through design resolutions (1440px, 375px, etc.).
  - **Live Configuration**: Change base font size and decimal precision on the fly.

---

## 📋 Commands & Shortcuts

| Action | Shortcut (Win/Linux) | Shortcut (macOS) |
| :--- | :--- | :--- |
| **Convert to Viewport** | \Ctrl+Alt+V\ | \Cmd+Alt+V\ |
| **Reverse to Px/Rem** | \Ctrl+Alt+Shift+V\ | \Cmd+Alt+Shift+V\ |
| **Cycle (vw)** | \Alt+V\ | \Alt+V\ |
| **Cycle (vh)** | \Alt+H\ | \Alt+H\ |
| **Cycle Tailwind/Rem** | \Alt+Z\ | \Alt+Z\ |
| **Cycle Target Screen** | \Alt+X\ | \Alt+X\ |

---

## ⚙️ Customization

Fine-tune **VC-Mate** to match your project's architecture:

- \c-mate.viewportScreens\: Define your list of design target resolutions.
- \c-mate.baseFontSize\: Set your root rem size (default: \16\).
- \c-mate.viewportPrecision\: Control the floating-point depth (default: \4\).
- \c-mate.useBrackets\: Toggle Tailwind-style \[value]\ syntax.

---

## 🎯 Supported Languages
Full support for **CSS**, **SCSS**, **Sass**, **Less**, **JavaScript/TypeScript** (CSS-in-JS), and **React** (JSX/TSX).

## 🏃 Quick Start
1. Place your cursor on a value like \16px\.
2. Press \Ctrl+Alt+V\.
3. Select your axis (\w\ or \h\) or let Auto-Detection handle it.
4. Done! Your value is now responsive.

---
Developed with ❤️ by **SanekxArcs**

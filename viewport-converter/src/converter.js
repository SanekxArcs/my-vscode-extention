const vscode = require('vscode')
const { getConfig, updateConfig } = require('./config')

const viewportUnits = ['vw', 'vh', 'vmin', 'vmax', 'dvw', 'dvh', 'lvw', 'lvh', 'svw', 'svh']

function detectValueAtPosition(document, position) {
  const line = document.lineAt(position.line).text
  const regex = /(-?\d*\.\d+|-?\d+)(px|rem|vw|vh|dvw|dvh|lvw|lvh|svw|svh|vmin|vmax)/g
  let match
  while ((match = regex.exec(line)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (position.character >= start && position.character <= end) {
      return { text: match[0], start, end }
    }
  }
  return null
}

function detectValueAtPositionLoose(document, position) {
  const line = document.lineAt(position.line).text;
  const regex = /(-)?(\[)?(-?\d*\.?\d+)(px|rem)?(\])?(?![a-zA-Z%])/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (position.character >= start && position.character <= end) {
      return { text: match[0], start, end };
    }
  }
  return null;
}

function toViewport(pxValue, dimension, precision) {
  if (!dimension) return null;
  const val = (pxValue / dimension) * 100;
  let result = val.toFixed(Math.max(0, Math.min(8, precision)));
  result = result.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
  return result;
}

function toFixedTrim(num, prec) {
  let result = num.toFixed(Math.max(0, Math.min(8, prec)));
  result = result.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
  return result;
}

function parseScreen(screenStr) {
  const match = (screenStr || "").toString().match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
}

function parseSelectedValue(text) {
  const match = text
    .trim()
    .match(
      /^(-?\d*\.?\d+)\s*(px|rem|vw|vh|dvw|dvh|lvw|lvh|svw|svh|vmin|vmax)$/i
    );
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: match[2].toLowerCase() };
}

function parseViewportValue(text) {
  const match = text
    .trim()
    .match(/^(-?\d*\.?\d+)\s*(vw|vh|vmin|vmax|dvw|dvh|lvw|lvh|svw|svh)$/i);
  if (!match) return null;
  return { value: parseFloat(match[1]), unit: match[2].toLowerCase() };
}

function parsePxRemOrTw(text) {
  const match = text.trim().match(/^(-)?(\[)?(-?\d*\.?\d+)\s*(px|rem)?(\])?$/i);
  if (!match) return null;
  return {
    prefix: match[1] || "",
    value: parseFloat(match[3]),
    unit: match[4] ? match[4].toLowerCase() : "tw",
  };
}

function formatByUnit(num, unit) {
  const decimals = unit === "px" ? 2 : unit === "rem" ? 4 : 3;
  let result = num.toFixed(decimals);
  result = result.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
  return result;
}

function guessAxis(lineText) {
  try {
    const match = lineText.match(/^\s*([A-Za-z_-][A-Za-z0-9_-]*)\s*[:=]/);
    if (!match) return null;
    const raw = match[1];
    const kebab = raw.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const widthProps = new Set([
      "width",
      "min-width",
      "max-width",
      "left",
      "right",
      "margin-left",
      "margin-right",
      "padding-left",
      "padding-right",
      "margin-inline-start",
      "margin-inline-end",
      "padding-inline-start",
      "padding-inline-end",
      "inline-size",
      "min-inline-size",
      "max-inline-size",
      "gap",
      "column-gap",
      "letter-spacing",
      "word-spacing",
      "text-indent",
      "translatex",
      "transform",
    ]);
    const heightProps = new Set([
      "height",
      "min-height",
      "max-height",
      "top",
      "bottom",
      "margin-top",
      "margin-bottom",
      "padding-top",
      "padding-bottom",
      "line-height",
      "row-gap",
      "block-size",
      "min-block-size",
      "max-block-size",
      "translatey",
    ]);
    if (widthProps.has(kebab)) return "vw";
    if (heightProps.has(kebab)) return "vh";
    return null;
  } catch {
    return null;
  }
}

function registerConverter(context, options = {}) {
  const {
    commandPrefix = "viewportConverter",
    configSection = "viewportConverter",
    getConfig: customGetConfig,
    updateConfig: customUpdateConfig,
  } = options;

  const cfgGet = customGetConfig || getConfig;
  const cfgUpdate = customUpdateConfig || updateConfig;

  const convertToViewportCmd = vscode.commands.registerCommand(
    `${commandPrefix}.convertToViewportUnit`,
    async () => {
      const cfg = cfgGet();
      const screens = cfg.get("viewportScreens", []);
      const precision = cfg.get("viewportPrecision", 4);
      const baseFontSize = cfg.get("baseFontSize", 16);

      if (!Array.isArray(screens) || screens.length === 0) {
        vscode.window.showErrorMessage(
          `No screens configured. Add entries in settings: ${configSection}.viewportScreens (e.g., 1440x1024).`
        );
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a file to use the converter.");
        return;
      }

      const autoAxis = cfg.get("autoDetectViewportAxis", true);
      let vwOrVh = null;
      if (!autoAxis) {
        vwOrVh = await vscode.window.showQuickPick(["vw", "vh"], {
          placeHolder: "Convert to vw or vh?",
          ignoreFocusOut: true,
        });
        if (!vwOrVh) return;
      }

      const lastScreen = cfg.get("lastUsedScreen", "1440x900");
      const sortedScreens = [...screens];
      if (lastScreen && sortedScreens.includes(lastScreen)) {
        const idx = sortedScreens.indexOf(lastScreen);
        sortedScreens.splice(idx, 1);
        sortedScreens.unshift(lastScreen);
      }

      const picked = await vscode.window.showQuickPick(
        sortedScreens.map((s) => s.toString()),
        {
          placeHolder: "Choose a target screen (WIDTHxHEIGHT)",
          ignoreFocusOut: true,
        }
      );
      if (!picked) return;

      const parsed = parseScreen(picked);
      if (!parsed) {
        vscode.window.showErrorMessage(
          `Invalid screen format: ${picked}. Expected WIDTHxHEIGHT like 1440x1024.`
        );
        return;
      }

      const denom = vwOrVh === "vw" ? parsed.width : parsed.height;
      if (!denom) {
        vscode.window.showErrorMessage(
          "Selected screen dimension is zero or invalid."
        );
        return;
      }

      const selections = editor.selections.length
        ? editor.selections
        : [editor.selection];

      await editor.edit((editBuilder) => {
        for (const sel of selections) {
          let text = editor.document.getText(sel);
          let currentAxis = vwOrVh;

          if (autoAxis) {
            currentAxis = guessAxis(editor.document.lineAt(sel.start.line).text) || cfg.get("lastUsedViewportUnit", "vw");
          }

          const denom = currentAxis === "vw" ? parsed.width : parsed.height;

          if (!text) {
            const hit = detectValueAtPosition(editor.document, sel.start);
            if (!hit) continue;
            const parsedValue = parseSelectedValue(hit.text);
            if (!parsedValue || !["px", "rem"].includes(parsedValue.unit))
              continue;
            const range = new vscode.Range(
              sel.start.line,
              hit.start,
              sel.start.line,
              hit.end
            );
            const px =
              parsedValue.unit === "rem"
                ? parsedValue.value * baseFontSize
                : parsedValue.value;
            const result = toViewport(px, denom, precision);
            if (result == null) continue;
            editBuilder.replace(range, `${result}${currentAxis}`);
            continue;
          }

          const parsedValue = parseSelectedValue(text);
          if (!parsedValue || !["px", "rem"].includes(parsedValue.unit))
            continue;
          const px =
            parsedValue.unit === "rem"
              ? parsedValue.value * baseFontSize
              : parsedValue.value;
          const result = toViewport(px, denom, precision);
          if (result == null) continue;
          editBuilder.replace(sel, `${result}${currentAxis}`);
        }
      });

      await cfgUpdate("lastUsedViewportUnit", vwOrVh);
      await cfgUpdate("lastUsedScreen", picked);

      vscode.window.showInformationMessage(
        `Converted to ${vwOrVh} for ${picked}`
      );
    }
  );
  context.subscriptions.push(convertToViewportCmd);

  const reverseConvertCmd = vscode.commands.registerCommand(
    `${commandPrefix}.reverseConvertFromViewportUnit`,
    async () => {
      const cfg = cfgGet();
      const screens = cfg.get("viewportScreens", []);
      const precision = cfg.get("viewportPrecision", 4);
      const baseFontSize = cfg.get("baseFontSize", 16);
      const defaultOutputUnit = cfg.get("defaultOutputUnit", "px");

      if (!Array.isArray(screens) || screens.length === 0) {
        vscode.window.showErrorMessage(
          `No screens configured. Add entries in settings: ${configSection}.viewportScreens (e.g., 1440x1024).`
        );
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a file to use the converter.");
        return;
      }

      const lastScreen = cfg.get("lastUsedScreen", "1440x900");
      const sortedScreens = [...screens];
      if (lastScreen && sortedScreens.includes(lastScreen)) {
        const idx = sortedScreens.indexOf(lastScreen);
        sortedScreens.splice(idx, 1);
        sortedScreens.unshift(lastScreen);
      }

      const picked = await vscode.window.showQuickPick(
        sortedScreens.map((s) => s.toString()),
        {
          placeHolder: "Choose a target screen (WIDTHxHEIGHT)",
          ignoreFocusOut: true,
        }
      );
      if (!picked) return;

      const parsed = parseScreen(picked);
      if (!parsed) {
        vscode.window.showErrorMessage(
          `Invalid screen format: ${picked}. Expected WIDTHxHEIGHT like 1440x1024.`
        );
        return;
      }

      const outputUnit = await vscode.window.showQuickPick(["px", "rem"], {
        placeHolder: `Output unit (default ${defaultOutputUnit})`,
        ignoreFocusOut: true,
      });
      if (!outputUnit) return;

      const selections = editor.selections.length
        ? editor.selections
        : [editor.selection];
      const unitRegex =
        /(-?\d*\.?\d+)\s*(vw|vh|vmin|vmax|dvw|dvh|lvw|lvh|svw|svh)\b/gi;

      await editor.edit((editBuilder) => {
        for (const sel of selections) {
          const text = editor.document.getText(sel);

          const convertMatch = (value, unit) => {
            let denom;
            if (unit.endsWith("vw")) denom = parsed.width;
            else if (unit.endsWith("vh")) denom = parsed.height;
            else if (unit === "vmin")
              denom = Math.min(parsed.width, parsed.height);
            else if (unit === "vmax")
              denom = Math.max(parsed.width, parsed.height);
            else denom = parsed.width;
            const px = (value / 100) * denom;
            return outputUnit === "rem"
              ? `${toFixedTrim(px / baseFontSize, precision)}rem`
              : `${toFixedTrim(px, precision)}px`;
          };

          if (!text) {
            const hit = detectValueAtPosition(editor.document, sel.start);
            if (!hit) continue;
            const parsedValue = parseViewportValue(hit.text);
            if (!parsedValue) continue;
            const range = new vscode.Range(
              sel.start.line,
              hit.start,
              sel.start.line,
              hit.end
            );
            editBuilder.replace(
              range,
              convertMatch(parsedValue.value, parsedValue.unit)
            );
          } else {
            const replacements = [];
            let unitMatch;
            while ((unitMatch = unitRegex.exec(text)) !== null) {
              const value = parseFloat(unitMatch[1]);
              const unit = unitMatch[2].toLowerCase();
              const startOffset = unitMatch.index;
              const endOffset = unitMatch.index + unitMatch[0].length;
              const startAbsolute =
                editor.document.offsetAt(sel.start) + startOffset;
              const endAbsolute =
                editor.document.offsetAt(sel.start) + endOffset;
              const startPos = editor.document.positionAt(startAbsolute);
              const endPos = editor.document.positionAt(endAbsolute);
              const out = convertMatch(value, unit);
              replacements.push({
                range: new vscode.Range(startPos, endPos),
                out,
              });
            }
            for (let i = replacements.length - 1; i >= 0; i--) {
              editBuilder.replace(replacements[i].range, replacements[i].out);
            }
          }
        }
      });

      await cfgUpdate("lastUsedScreen", picked);
      vscode.window.showInformationMessage(
        `Converted viewport units to ${outputUnit} for ${picked}`
      );
    }
  );
  context.subscriptions.push(reverseConvertCmd);

  const cycleTailwindCmd = vscode.commands.registerCommand(
    `${commandPrefix}.cycleTailwindUnit`,
    async () => {
      const cfg = cfgGet();
      const baseFontSize = cfg.get("baseFontSize", 16);
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(
          "Open a file to use the Tailwind unit cycler."
        );
        return;
      }

      const selections = editor.selections.length
        ? editor.selections
        : [editor.selection];

      await editor.edit((editBuilder) => {
        for (const sel of selections) {
          let text = editor.document.getText(sel);

          if (!text) {
            const hit = detectValueAtPositionLoose(editor.document, sel.start);
            if (!hit) continue;
            text = hit.text;
            const parsed = parsePxRemOrTw(text);
            if (!parsed) continue;
            let out;
            if (parsed.unit === "px") {
              const rem = Math.abs(parsed.value) / baseFontSize;
              out = `${parsed.prefix}[${formatByUnit(rem, "rem")}rem]`;
            } else if (parsed.unit === "rem") {
              const tw = Math.abs(parsed.value) * 4;
              out = `${parsed.prefix}${formatByUnit(tw, "tw")}`;
            } else {
              const px = (Math.abs(parsed.value) * baseFontSize) / 4;
              out = `${parsed.prefix}[${formatByUnit(px, "px")}px]`;
            }
            const range = new vscode.Range(
              sel.start.line,
              hit.start,
              sel.start.line,
              hit.end
            );
            editBuilder.replace(range, out);
            continue;
          }

          const parsed = parsePxRemOrTw(text);
          if (!parsed) continue;
          let out;
          if (parsed.unit === "px") {
            const rem = Math.abs(parsed.value) / baseFontSize;
            out = `${parsed.prefix}[${formatByUnit(rem, "rem")}rem]`;
          } else if (parsed.unit === "rem") {
            const tw = Math.abs(parsed.value) * 4;
            out = `${parsed.prefix}${formatByUnit(tw, "tw")}`;
          } else {
            const px = (Math.abs(parsed.value) * baseFontSize) / 4;
            out = `${parsed.prefix}[${formatByUnit(px, "px")}px]`;
          }
          editBuilder.replace(sel, out);
        }
      });
    }
  );
  context.subscriptions.push(cycleTailwindCmd);

  async function runConvertCycleAxis(axis) {
    const cfg = cfgGet();
    const precision = cfg.get("viewportPrecision", 4);
    const baseFontSize = cfg.get("baseFontSize", 16);
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open a file to convert.");
      return;
    }

    const screen = parseScreen(cfg.get("lastUsedScreen", "1440x900"));
    if (!screen) {
      vscode.window.showErrorMessage(
        `Invalid ${configSection}.lastUsedScreen setting.`
      );
      return;
    }

    const denom = axis === "vw" ? screen.width : screen.height;
    const selections = editor.selections.length
      ? editor.selections
      : [editor.selection];
    const tokenRegex =
      axis === "vw"
        ? /(-?\d*\.?\d+)\s*(px|rem|vw)\b/gi
        : /(-?\d*\.?\d+)\s*(px|rem|vh)\b/gi;

    await editor.edit((editBuilder) => {
      for (const sel of selections) {
        const text = editor.document.getText(sel);
        if (!text) {
          const hit = detectValueAtPosition(editor.document, sel.start);
          if (!hit) continue;
          const match = hit.text
            .trim()
            .match(/^(-?\d*\.?\d+)\s*(px|rem|vw|vh)$/i);
          if (!match) continue;
          const value = parseFloat(match[1]);
          const unit = match[2].toLowerCase();
          const range = new vscode.Range(
            sel.start.line,
            hit.start,
            sel.start.line,
            hit.end
          );
          let out = null;
          if (
            (axis === "vw" && unit === "vw") ||
            (axis === "vh" && unit === "vh")
          ) {
            const px = (value / 100) * denom;
            out = `${toFixedTrim(px, precision)}px`;
          } else if (unit === "px" || unit === "rem") {
            const px = unit === "rem" ? value * baseFontSize : value;
            const transformed = toViewport(px, denom, precision);
            if (transformed != null) out = `${transformed}${axis}`;
          }
          if (out) editBuilder.replace(range, out);
        } else {
          const replacements = [];
          let match;
          while ((match = tokenRegex.exec(text)) !== null) {
            const value = parseFloat(match[1]);
            const unit = match[2].toLowerCase();
            let out = null;
            if (
              (axis === "vw" && unit === "vw") ||
              (axis === "vh" && unit === "vh")
            ) {
              const px = (value / 100) * denom;
              out = `${toFixedTrim(px, precision)}px`;
            } else if (unit === "px" || unit === "rem") {
              const px = unit === "rem" ? value * baseFontSize : value;
              const transformed = toViewport(px, denom, precision);
              if (transformed != null) out = `${transformed}${axis}`;
            }
            if (!out) continue;
            const startOffset = match.index;
            const endOffset = match.index + match[0].length;
            const startAbsolute =
              editor.document.offsetAt(sel.start) + startOffset;
            const endAbsolute = editor.document.offsetAt(sel.start) + endOffset;
            const startPos = editor.document.positionAt(startAbsolute);
            const endPos = editor.document.positionAt(endAbsolute);
            replacements.push({
              range: new vscode.Range(startPos, endPos),
              out,
            });
          }
          for (let i = replacements.length - 1; i >= 0; i--) {
            editBuilder.replace(replacements[i].range, replacements[i].out);
          }
        }
      }
    });
  }

  const cycleVWCmd = vscode.commands.registerCommand(
    `${commandPrefix}.convertCycleVW`,
    async () => runConvertCycleAxis("vw")
  );
  const cycleVHCmd = vscode.commands.registerCommand(
    `${commandPrefix}.convertCycleVH`,
    async () => runConvertCycleAxis("vh")
  );
  context.subscriptions.push(cycleVWCmd, cycleVHCmd);

  const codeActionProvider = {
    provideCodeActions(document, range) {
      const cursor =
        range?.start || vscode.window.activeTextEditor?.selection.start;
      if (!cursor) return;
      const hit = detectValueAtPosition(document, cursor);
      if (!hit) return;
      const parsed = parseSelectedValue(hit.text);
      if (!parsed) return;

      const actions = [];
      if (["px", "rem"].includes(parsed.unit)) {
        const action = new vscode.CodeAction(
          "Convert to vw/vh",
          vscode.CodeActionKind.RefactorRewrite
        );
        action.command = {
          command: `${commandPrefix}.convertToViewportUnit`,
          title: "Convert to vw/vh",
        };
        actions.push(action);
      }
      if (viewportUnits.includes(parsed.unit)) {
        const action = new vscode.CodeAction(
          "Convert vw/vh to px/rem",
          vscode.CodeActionKind.RefactorRewrite
        );
        action.command = {
          command: `${commandPrefix}.reverseConvertFromViewportUnit`,
          title: "Convert vw/vh to px/rem",
        };
        actions.push(action);
      }
      return actions;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [
        "css",
        "scss",
        "sass",
        "less",
        "javascript",
        "typescript",
        "javascriptreact",
        "typescriptreact",
      ],
      codeActionProvider,
      {
        providedCodeActionKinds: [
          vscode.CodeActionKind.Refactor,
          vscode.CodeActionKind.RefactorRewrite,
        ],
      }
    )
  );

  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    95
  );
  const quickConvertItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    94
  );

  const updateStatus = () => {
    const screenValue = cfgGet().get("lastUsedScreen", "1440x900");
    const base = cfgGet().get("baseFontSize", 16);
    const precision = cfgGet().get("viewportPrecision", 4);
    const screenText = (
      typeof screenValue === "string" ? screenValue : String(screenValue)
    ).replace("x", "×");
    statusItem.text = `$(device-mobile) ${screenText} | ${base}px | p${precision}`;
    statusItem.tooltip =
      "Click to change viewport screen, base font size, or precision";
  };

  const cycleScreenCmd = vscode.commands.registerCommand(
    `${commandPrefix}.cycleViewportScreen`,
    async () => {
      const cfg = cfgGet();
      const screens = cfg.get("viewportScreens", []);
      if (!Array.isArray(screens) || screens.length === 0) {
        vscode.window.showErrorMessage(
          `No screens configured. Add entries in settings: ${configSection}.viewportScreens (e.g., 1440x1024).`
        );
        return;
      }
      const current = cfg.get("lastUsedScreen", screens[0]);
      const idx = screens.map(String).indexOf(String(current));
      const next = screens[idx >= 0 ? (idx + 1) % screens.length : 0];
      await cfgUpdate("lastUsedScreen", String(next));
      updateStatus();
    }
  );
  context.subscriptions.push(cycleScreenCmd);

  const settingsCmd = vscode.commands.registerCommand(
    `${commandPrefix}.viewportSettingsQuick`,
    async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: "Change screen", action: "screen" },
          { label: "Change base font size", action: "base" },
          { label: "Change precision", action: "precision" },
        ],
        { placeHolder: "Viewport settings" }
      );
      if (!pick) return;

      const cfg = cfgGet();
      if (pick.action === "screen") {
        const screens = cfg.get("viewportScreens", []);
        const chosen = await vscode.window.showQuickPick(
          (screens || []).map(String),
          {
            placeHolder: "Select design screen WIDTHxHEIGHT",
          }
        );
        if (chosen) await cfgUpdate("lastUsedScreen", chosen);
      } else if (pick.action === "base") {
        const current = cfg.get("baseFontSize", 16);
        const input = await vscode.window.showInputBox({
          prompt: "Base font size (px)",
          value: String(current),
          validateInput: (value) =>
            /^\d+(\.\d+)?$/.test(value) && parseFloat(value) > 0
              ? null
              : "Enter a positive number",
        });
        if (input) await cfgUpdate("baseFontSize", parseFloat(input));
      } else if (pick.action === "precision") {
        const current = cfg.get("viewportPrecision", 4);
        const options = Array.from({ length: 9 }, (_, i) => String(i));
        const chosen = await vscode.window.showQuickPick(options, {
          placeHolder: `Select precision (current ${current})`,
        });
        if (chosen != null)
          await cfgUpdate("viewportPrecision", parseInt(chosen, 10));
      }
      updateStatus();
    }
  );
  context.subscriptions.push(settingsCmd);

  statusItem.command = `${commandPrefix}.viewportSettingsQuick`;
  quickConvertItem.text = "$(wand) Convert Here";
  quickConvertItem.tooltip =
    "Convert values at cursor/selection to current viewport axis";
  quickConvertItem.command = `${commandPrefix}.convertHereQuick`;

  function updateStatusBarVisibility() {
    const cfg = cfgGet();
    const showStatusBar = cfg.get("showViewportStatusBar", true);
    if (showStatusBar) {
      updateStatus();
      statusItem.show();
      quickConvertItem.show();
    } else {
      statusItem.hide();
      quickConvertItem.hide();
    }
  }

  updateStatusBarVisibility();

  const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration(`${configSection}.lastUsedScreen`) ||
      event.affectsConfiguration(`${configSection}.baseFontSize`) ||
      event.affectsConfiguration(`${configSection}.viewportPrecision`)
    ) {
      updateStatus();
    }
    if (event.affectsConfiguration(`${configSection}.showViewportStatusBar`)) {
      updateStatusBarVisibility();
    }
  });
  context.subscriptions.push(configWatcher);

  const quickConvertCmd = vscode.commands.registerCommand(
    `${commandPrefix}.convertHereQuick`,
    async () => {
      const cfg = cfgGet();
      const screens = cfg.get("viewportScreens", []);
      const precision = cfg.get("viewportPrecision", 4);
      const baseFontSize = cfg.get("baseFontSize", 16);
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a file to convert.");
        return;
      }

      const lastScreen = cfg.get("lastUsedScreen", "1440x900");
      const parsed = parseScreen(lastScreen);
      if (!parsed) {
        vscode.window.showErrorMessage(
          `Invalid ${configSection}.lastUsedScreen setting.`
        );
        return;
      }

      const autoAxis = cfg.get("autoDetectViewportAxis", true);

      const selections = editor.selections.length
        ? editor.selections
        : [editor.selection];
      const pxRemRegex = /(-?\d*\.?\d+)\s*(px|rem)\b/gi;

      await editor.edit((editBuilder) => {
        for (const sel of selections) {
          let axis = "vw";
          if (autoAxis) {
            axis = guessAxis(editor.document.lineAt(sel.start.line).text) || cfg.get("lastUsedViewportUnit", "vw");
          }

          const denom = axis === "vw" ? parsed.width : parsed.height;
          const text = editor.document.getText(sel);
          if (!text) {
            const hit = detectValueAtPosition(editor.document, sel.start);
            if (!hit) continue;
            const parsedVal = parseSelectedValue(hit.text);
            if (!parsedVal || !["px", "rem"].includes(parsedVal.unit)) continue;
            const range = new vscode.Range(
              sel.start.line,
              hit.start,
              sel.start.line,
              hit.end
            );
            const px =
              parsedVal.unit === "rem"
                ? parsedVal.value * baseFontSize
                : parsedVal.value;
            const out = toViewport(px, denom, precision);
            if (out == null) continue;
            editBuilder.replace(range, `${out}${axis}`);
          } else {
            const replacements = [];
            let match;
            while ((match = pxRemRegex.exec(text)) !== null) {
              const value = parseFloat(match[1]);
              const unit = match[2].toLowerCase();
              const px = unit === "rem" ? value * baseFontSize : value;
              const out = `${toViewport(px, denom, precision)}${axis}`;
              const startOffset = match.index;
              const endOffset = match.index + match[0].length;
              const startAbsolute =
                editor.document.offsetAt(sel.start) + startOffset;
              const endAbsolute =
                editor.document.offsetAt(sel.start) + endOffset;
              const startPos = editor.document.positionAt(startAbsolute);
              const endPos = editor.document.positionAt(endAbsolute);
              replacements.push({
                range: new vscode.Range(startPos, endPos),
                out,
              });
            }
            for (let i = replacements.length - 1; i >= 0; i--) {
              editBuilder.replace(replacements[i].range, replacements[i].out);
            }
          }
        }
      });
    }
  );
  context.subscriptions.push(quickConvertCmd);

  context.subscriptions.push(statusItem, quickConvertItem);
}

module.exports = { registerConverter }

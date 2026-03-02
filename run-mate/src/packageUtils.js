const vscode = require('vscode')
const { parse } = require('jsonc-parser')

function getWorkspaceFolders() {
  return vscode.workspace.workspaceFolders ?? []
}

function slugify(id) {
  return String(id)
    .replace(/[^a-z0-9\-]/gi, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

async function readPackageJson(uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri)
    const text = Buffer.from(bytes).toString('utf8')
    return parse(text)
  } catch (error) {
    try {
      await vscode.workspace.fs.stat(uri);
      vscode.window.showErrorMessage(
        `RunMate: invalid or unreadable package.json at ${uri.fsPath}`
      );
    } catch {
    }
    return null
  }
}

async function checkNvmrcExists(folderUri) {
  try {
    const nvmrcUri = vscode.Uri.joinPath(folderUri, ".nvmrc");
    await vscode.workspace.fs.stat(nvmrcUri);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(folderUri, pkg) {
  const pmField = pkg?.packageManager
  if (typeof pmField === 'string') {
    if (pmField.startsWith('pnpm')) return 'pnpm'
    if (pmField.startsWith('yarn')) return 'yarn'
    if (pmField.startsWith('bun')) return 'bun'
  }

  const exists = async (name) => {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(folderUri, name))
      return true
    } catch {
      return false
    }
  }

  if (await exists('pnpm-lock.yaml')) return 'pnpm'
  if (await exists('yarn.lock')) return 'yarn'
  if (await exists('bun.lockb')) return 'bun'
  if (await exists('bun.lock')) return 'bun'
  return 'npm'
}

async function checkNodeModulesExists(folderUri) {
  try {
    const modulesUri = vscode.Uri.joinPath(folderUri, "node_modules");
    await vscode.workspace.fs.stat(modulesUri);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getWorkspaceFolders,
  slugify,
  readPackageJson,
  checkNvmrcExists,
  detectPackageManager,
  checkNodeModulesExists
}

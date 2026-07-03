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
    if (pmField.startsWith('yarn@1')) return 'yarn'
    if (pmField.startsWith('yarn')) return 'yarn-berry'  // v2+
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
  if (await exists('.yarnrc.yml')) return 'yarn-berry'  // Yarn Berry uses .yarnrc.yml
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

/**
 * For Yarn Berry (v2+), dependencies may be installed without a node_modules
 * directory (PnP mode). Check for the Yarn-specific install-state file or
 * PnP loader as evidence that `yarn install` has already been run.
 */
async function checkYarnInstallState(folderUri) {
  const exists = async (name) => {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(folderUri, name));
      return true;
    } catch {
      return false;
    }
  };
  return (
    (await exists(".yarn/install-state.gz")) ||
    (await exists(".pnp.cjs")) ||
    (await exists(".pnp.js"))
  );
}

/**
 * Returns true when dependencies appear to be installed for the given PM.
 * For yarn we check both node_modules (node-modules linker) and the
 * Yarn Berry install-state / PnP artefacts.
 */
async function checkDependenciesInstalled(folderUri, pm) {
  if (pm === 'yarn' || pm === 'yarn-berry') {
    return (
      (await checkNodeModulesExists(folderUri)) ||
      (await checkYarnInstallState(folderUri))
    );
  }
  return checkNodeModulesExists(folderUri);
}

module.exports = {
  getWorkspaceFolders,
  slugify,
  readPackageJson,
  checkNvmrcExists,
  detectPackageManager,
  checkNodeModulesExists,
  checkDependenciesInstalled,
}

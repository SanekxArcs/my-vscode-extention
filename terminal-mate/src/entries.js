const vscode = require('vscode')
const { getConfig } = require('./config')

const hasText = (value) => typeof value === 'string' && value.trim() !== ''

// A chain is an entry that runs other saved commands, referenced by title, in order
const isChain = (entry) => Array.isArray(entry?.chain) && entry.chain.some(hasText)

const isValidEntry = (entry) => Boolean(entry) && hasText(entry.title) && (hasText(entry.command) || isChain(entry))

const describeEntry = (entry) =>
  isChain(entry) ? `chain: ${entry.chain.filter(hasText).join(' → ')}` : String(entry.command || '').trim()

const loadEntries = () => {
  const value = getConfig().get('customTerminals', [])
  return Array.isArray(value) ? value : []
}

async function saveEntries(entries) {
  const cfg = getConfig()
  const target =
    cfg.get('saveCommandsToWorkspace', false) && vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global
  await cfg.update('customTerminals', entries, target)
}

function findByTitle(entries, title) {
  const wanted = String(title || '').trim()
  if (!wanted) return null
  const valid = entries.filter(isValidEntry)
  return (
    valid.find((entry) => entry.title.trim() === wanted) ||
    valid.find((entry) => entry.title.trim().toLowerCase() === wanted.toLowerCase()) ||
    null
  )
}

// Flattens a chain (and any chains inside it) into plain command entries
function expandChain(entry, entries, trail = []) {
  if (!isChain(entry)) return [entry]
  const title = entry.title.trim()
  if (trail.includes(title)) throw new Error(`Chain "${title}" ends up running itself.`)
  const steps = []
  for (const stepTitle of entry.chain.filter(hasText)) {
    const step = findByTitle(entries, stepTitle)
    if (!step) throw new Error(`Chain "${title}": step "${stepTitle}" is not in your saved commands.`)
    steps.push(...expandChain(step, entries, [...trail, title]))
  }
  return steps
}

// Keeps only the fields TerminalMate understands; returns null for unusable entries
function sanitizeEntry(raw) {
  if (!isValidEntry(raw)) return null
  const entry = { title: raw.title.trim() }
  if (isChain(raw)) entry.chain = raw.chain.filter(hasText).map((step) => step.trim())
  else entry.command = raw.command.trim()
  if (hasText(raw.cwd)) entry.cwd = raw.cwd
  if (hasText(raw.group)) entry.group = raw.group.trim()
  if (typeof raw.reuse === 'boolean') entry.reuse = raw.reuse
  if (hasText(raw.os)) entry.os = raw.os
  else if (Array.isArray(raw.os) && raw.os.every(hasText)) entry.os = raw.os
  if (raw.archived === true) entry.archived = true
  return entry
}

module.exports = {
  hasText,
  isChain,
  isValidEntry,
  describeEntry,
  loadEntries,
  saveEntries,
  findByTitle,
  expandChain,
  sanitizeEntry,
}

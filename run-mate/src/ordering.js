/**
 * Pure ordering rules for script lists (no vscode), shared by the status bar
 * and the picker so both always show scripts in the same order.
 *
 * An entry has a `name` ("build") and a `script` id that is unique inside its
 * project ("build" for package.json, "make:build" for a Makefile target).
 */

const KIND_ORDER = ['npm', 'deno', 'just', 'make']

/**
 * Sorts entries: scripts in the user's custom order come first, in that
 * order; the rest follow by `scriptOrder` priority, then package.json scripts
 * before other sources, then alphabetically.
 */
function sortEntries(entries, customOrder = [], scriptOrder = []) {
  const customIndex = new Map(customOrder.map((script, index) => [script, index]))
  const priorityIndex = new Map(scriptOrder.map((name, index) => [name, index]))
  const rank = (map, key) => (map.has(key) ? map.get(key) : Number.MAX_SAFE_INTEGER)
  const kindRank = (entry) => {
    const index = KIND_ORDER.indexOf(entry.kind)
    return index === -1 ? 0 : index
  }

  return [...entries].sort(
    (a, b) =>
      rank(customIndex, a.script) - rank(customIndex, b.script) ||
      rank(priorityIndex, a.name) - rank(priorityIndex, b.name) ||
      kindRank(a) - kindRank(b) ||
      a.name.localeCompare(b.name)
  )
}

/**
 * Splits one project's entries into the three blocks the UI shows:
 * favorites, the other visible scripts, and hidden scripts.
 */
function arrange(entries, { favorites, hidden, customOrder, scriptOrder }) {
  const sorted = sortEntries(entries, customOrder, scriptOrder)
  const result = { favorites: [], others: [], hidden: [] }
  for (const entry of sorted) {
    if (hidden.has(entry.key)) result.hidden.push(entry)
    else if (favorites.has(entry.key)) result.favorites.push(entry)
    else result.others.push(entry)
  }
  return result
}

/**
 * Moves an entry one step up (-1) or down (+1) inside its own block.
 * Returns the new custom order (a full list of script ids), or null when the
 * entry is already at the edge of its block.
 */
function moveEntry(arranged, entry, direction) {
  const blocks = [arranged.favorites, arranged.others, arranged.hidden].map((block) => [...block])
  const block = blocks.find((items) => items.some((item) => item.key === entry.key))
  if (!block) return null
  const from = block.findIndex((item) => item.key === entry.key)
  const to = from + direction
  if (to < 0 || to >= block.length) return null
  ;[block[from], block[to]] = [block[to], block[from]]
  return blocks.flat().map((item) => item.script)
}

module.exports = { sortEntries, arrange, moveEntry }

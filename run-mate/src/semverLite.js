/**
 * A small reader for the version ranges people write in `engines.node`
 * (">=18", "^20.10", "18 || 20", ">=18 <21", "20.x"). It answers one
 * question: does this Node version fit? Anything it cannot read gives
 * `null`, which callers treat as "unknown, say nothing".
 */

function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text).trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/** "1.2" -> [1, 2]; "1.x" -> [1]; "*" -> []. Returns null when unreadable. */
function parsePartial(text) {
  const m = /^v?(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:[-+].*)?$/.exec(text)
  if (!m) return null
  const parts = []
  for (const piece of [m[1], m[2], m[3]]) {
    if (piece === undefined || !/^\d+$/.test(piece)) break
    parts.push(Number(piece))
  }
  return parts
}

const full = (parts) => [parts[0] || 0, parts[1] || 0, parts[2] || 0]

/** The first version above everything a partial version covers: [1, 2] -> 1.3.0 */
function ceiling(parts) {
  if (parts.length === 0) return null
  if (parts.length === 1) return [parts[0] + 1, 0, 0]
  if (parts.length === 2) return [parts[0], parts[1] + 1, 0]
  return null
}

/** One comparator ("^20.10", ">=18") as a list of `{ op, version }` bounds. */
function bounds(token) {
  const m = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token)
  const op = m[1] || ''
  const parts = parsePartial(m[2])
  if (!parts) return null
  if (parts.length === 0) return op === '<' || op === '>' ? null : []

  const low = { op: '>=', version: full(parts) }
  const top = ceiling(parts)

  switch (op) {
    case '^': {
      let upper
      if (parts[0] > 0 || parts.length === 1) upper = [parts[0] + 1, 0, 0]
      else if (parts[1] > 0 || parts.length === 2) upper = [0, (parts[1] || 0) + 1, 0]
      else upper = [0, 0, parts[2] + 1]
      return [low, { op: '<', version: upper }]
    }
    case '~':
      return [low, { op: '<', version: parts.length === 1 ? [parts[0] + 1, 0, 0] : [parts[0], parts[1] + 1, 0] }]
    case '>=':
      return [low]
    case '>':
      return top ? [{ op: '>=', version: top }] : [{ op: '>', version: full(parts) }]
    case '<=':
      return top ? [{ op: '<', version: top }] : [{ op: '<=', version: full(parts) }]
    case '<':
      return [{ op: '<', version: full(parts) }]
    default:
      return top ? [low, { op: '<', version: top }] : [{ op: '=', version: full(parts) }]
  }
}

function test(bound, version) {
  const diff = compare(version, bound.version)
  switch (bound.op) {
    case '>=':
      return diff >= 0
    case '>':
      return diff > 0
    case '<=':
      return diff <= 0
    case '<':
      return diff < 0
    default:
      return diff === 0
  }
}

/** true / false, or null when the range or the version cannot be read. */
function satisfies(range, version) {
  const actual = parseVersion(version)
  if (!actual || typeof range !== 'string') return null

  let anyReadable = false
  for (const alternative of range.split('||')) {
    const text = alternative
      .trim()
      .replace(/(\S+)\s+-\s+(\S+)/g, '>=$1 <=$2')
      .replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
    const tokens = text ? text.split(/\s+/) : ['*']
    const all = tokens.map(bounds)
    if (all.some((list) => list === null)) continue
    anyReadable = true
    if (all.flat().every((bound) => test(bound, actual))) return true
  }
  return anyReadable ? false : null
}

/**
 * A major version worth installing for a range: the highest major the range
 * mentions that fits it (">=18 <21" -> 18, "18 || 20" -> 20). Null if none.
 */
function suggestMajor(range) {
  const majors = [...new Set((String(range).match(/\d+(?:\.\d+)*/g) || []).map((text) => Number(text.split('.')[0])))]
  return (
    majors
      .sort((a, b) => b - a)
      .find((major) => satisfies(range, `${major}.999.999`) === true) ?? null
  )
}

module.exports = { satisfies, suggestMajor }

const STORAGE_KEY = 'run-mate.favorites'

/**
 * Builds a stable key for an entry.
 * Multi-folder "pick" entries (no .folder) use an empty folder segment so
 * the star is tied to the script name rather than a specific workspace folder.
 */
function makeFavoriteKey(entry) {
  const folderName = entry.folder ? entry.folder.name : ''
  return `${folderName}::${entry.name}`
}

function getFavorites(context) {
  return new Set(context.globalState.get(STORAGE_KEY, []))
}

async function toggleFavorite(context, key) {
  const favs = getFavorites(context)
  if (favs.has(key)) {
    favs.delete(key)
  } else {
    favs.add(key)
  }
  await context.globalState.update(STORAGE_KEY, [...favs])
}

module.exports = { makeFavoriteKey, getFavorites, toggleFavorite }

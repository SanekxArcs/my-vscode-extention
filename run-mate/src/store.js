const FAVORITES_KEY = 'run-mate.favorites'
const HIDDEN_KEY = 'run-mate.hidden'
const ORDER_KEY = 'run-mate.order'
const GROUPS_KEY = 'run-mate.groups'
const ARGS_KEY = 'run-mate.recentArgs'
const LAST_RUN_KEY = 'run-mate.lastRun'
const ENV_KEY = 'run-mate.envFiles'

const MAX_RECENT_ARGS = 5

/**
 * Everything the user arranged in the script list. It all belongs to one
 * workspace, so a star in one repository does not show up in another
 * repository that happens to have a folder with the same name.
 */
class Store {
  constructor(context) {
    this.state = context.workspaceState
    this.globalState = context.globalState
  }

  /**
   * Versions before 1.5 kept favorites globally. Until the first change in
   * this workspace those old stars are still used, so nothing disappears.
   */
  favorites() {
    const own = this.state.get(FAVORITES_KEY)
    return new Set(Array.isArray(own) ? own : this.globalState.get(FAVORITES_KEY, []))
  }

  async toggleFavorite(key) {
    const favorites = this.favorites()
    if (!favorites.delete(key)) favorites.add(key)
    await this.state.update(FAVORITES_KEY, [...favorites])
  }

  hidden() {
    return new Set(this.state.get(HIDDEN_KEY, []))
  }

  async toggleHidden(key) {
    const hidden = this.hidden()
    if (!hidden.delete(key)) hidden.add(key)
    await this.state.update(HIDDEN_KEY, [...hidden])
  }

  async clearHidden() {
    await this.state.update(HIDDEN_KEY, [])
  }

  /** Custom order (script ids) of one list: a project key, or '' for a merged list. */
  order(groupKey) {
    const all = this.state.get(ORDER_KEY, {})
    return Array.isArray(all[groupKey]) ? all[groupKey] : []
  }

  async setOrder(groupKey, scripts) {
    await this.state.update(ORDER_KEY, { ...this.state.get(ORDER_KEY, {}), [groupKey]: scripts })
  }

  async clearOrder() {
    await this.state.update(ORDER_KEY, {})
  }

  /** Groups: `[{ id, name, keys }]`, where keys are entry keys. */
  groups() {
    const groups = this.state.get(GROUPS_KEY, [])
    return Array.isArray(groups) ? groups : []
  }

  /** Adds a group, or replaces the one with the same id. */
  async saveGroup(group) {
    const groups = this.groups()
    const index = groups.findIndex((other) => other.id === group.id)
    if (index === -1) groups.push(group)
    else groups[index] = group
    await this.state.update(GROUPS_KEY, groups)
  }

  async deleteGroup(id) {
    await this.state.update(
      GROUPS_KEY,
      this.groups().filter((group) => group.id !== id)
    )
  }

  /** Arguments used with a script before, newest first. */
  recentArgs(key) {
    const all = this.state.get(ARGS_KEY, {})
    return Array.isArray(all[key]) ? all[key] : []
  }

  async addRecentArgs(key, args) {
    const recent = [args, ...this.recentArgs(key).filter((other) => other !== args)].slice(0, MAX_RECENT_ARGS)
    await this.state.update(ARGS_KEY, { ...this.state.get(ARGS_KEY, {}), [key]: recent })
  }

  /**
   * The env file chosen for a script: a path relative to its project,
   * '' for "none", or undefined when nothing was chosen (the setting applies).
   */
  envFile(key) {
    const value = this.state.get(ENV_KEY, {})[key]
    return typeof value === 'string' ? value : undefined
  }

  async setEnvFile(key, file) {
    const all = { ...this.state.get(ENV_KEY, {}) }
    if (file === undefined) delete all[key]
    else all[key] = file
    await this.state.update(ENV_KEY, all)
  }

  /** `{ id, shell, args }` of the script that was started last. */
  lastRun() {
    return this.state.get(LAST_RUN_KEY)
  }

  async setLastRun(run) {
    await this.state.update(LAST_RUN_KEY, run)
  }
}

module.exports = { Store }

// One pattern for Host actions: block duplicates while busy, never swallow failures,
// and turn Supabase errors into messages a Host can act on.

// The database is older than this screen: a migration has not been applied (or the API has
// not reloaded its schema). Say so plainly instead of a generic retry message.
export function missingServerFunction(error) {
  if (!['PGRST202', '42883'].includes(error?.code)) return null
  return String(error?.message || '').match(/function (?:public\.)?([a-z_]+)/)?.[1] || 'unknown'
}

export function friendlyHostError(error, fallback = 'Something went wrong. Please try again.') {
  const message = String(error?.message || '').trim()
  const missing = missingServerFunction(error)
  if (missing) return `Game Night’s database is missing an update this screen needs (${missing}). Apply the latest database migrations, then reload the page.`
  if (error?.code === '42501') return 'You don’t have permission to change this Game Night. Try signing in again.'
  if (['40001', '55000', '22023'].includes(error?.code) && message) return message
  if (error?.name === 'TypeError' || /failed to fetch|network|load failed/i.test(message)) return 'Couldn’t reach Game Night. Check the connection and try again.'
  return fallback
}

export function createActionRunner({ showError, clearError = () => {}, onBusyChange = () => {} }) {
  const busy = new Set()
  return {
    isBusy: key => (key ? busy.has(key) : busy.size > 0),
    async run(key, action, { failure } = {}) {
      if (busy.has(key)) return { ok: false, skipped: true }
      busy.add(key); clearError(); onBusyChange()
      try {
        return { ok: true, value: await action() }
      } catch (error) {
        console.error(error)
        showError(friendlyHostError(error, failure), error)
        return { ok: false, error }
      } finally {
        busy.delete(key); onBusyChange()
      }
    },
  }
}

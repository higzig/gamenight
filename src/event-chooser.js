const LIVE_STATUSES = new Set(['ready', 'question', 'suspense', 'locked', 'reveal', 'leaderboard'])

export function localCalendarDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isLiveEvent(event) {
  return LIVE_STATUSES.has(String(event?.status ?? '').toLowerCase())
}

export function classifyEvents(events, today = localCalendarDate()) {
  const current = []
  const archived = []

  for (const event of events) {
    if (event.event_date >= today || isLiveEvent(event)) current.push(event)
    else archived.push(event)
  }

  const currentRank = event => event.event_date === today ? 0 : event.event_date > today ? 1 : 2
  current.sort((a, b) => currentRank(a) - currentRank(b)
    || (currentRank(a) === 2 ? b.event_date.localeCompare(a.event_date) : a.event_date.localeCompare(b.event_date))
    || String(a.name).localeCompare(String(b.name)))
  archived.sort((a, b) => b.event_date.localeCompare(a.event_date) || String(a.name).localeCompare(String(b.name)))

  return { current, archived }
}

export function humanEventStatus(status) {
  const value = String(status ?? '').toLowerCase()
  if (value === 'lobby') return 'Lobby'
  if (value === 'ready') return 'Ready'
  if (['question', 'suspense', 'locked', 'reveal'].includes(value)) return 'Live'
  if (value === 'leaderboard') return 'Leaderboard'
  if (['round_complete', 'complete', 'completed', 'ended'].includes(value)) return 'Completed'
  return value ? value.replaceAll('_', ' ').replace(/^./, character => character.toUpperCase()) : 'Draft'
}

export function formatEventDate(value, locale = 'en-GB') {
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day))
}

import { GAME_CATALOG, TYPE_FOR_GAME_TYPE } from './game-catalog.js'

export const MAX_LINEUP = 4

// Running-order operations return a new list of game types and never mutate their input.
export function addGame(types, type) {
  if (!GAME_CATALOG[type] || types.includes(type) || types.length >= MAX_LINEUP) return types
  return [...types, type]
}

export function removeGame(types, type) {
  return types.filter(item => item !== type)
}

// Replacing keeps the original game's position in the running order.
export function replaceGame(types, current, next) {
  if (!GAME_CATALOG[next] || !types.includes(current) || (next !== current && types.includes(next))) return types
  return types.map(item => item === current ? next : item)
}

export function moveGame(types, type, toIndex) {
  const from = types.indexOf(type)
  if (from < 0 || toIndex < 0 || toIndex >= types.length || toIndex === from) return types
  const next = [...types]
  next.splice(from, 1)
  next.splice(toIndex, 0, type)
  return next
}

export function serverLineupTypes(snapshot) {
  return (snapshot?.lineup?.games || []).map(game => TYPE_FOR_GAME_TYPE[game.game_type]).filter(Boolean)
}

export const lineupSaved = snapshot => snapshot?.lineup?.revision != null

// One-time adoption for nights created before the running order moved to the server: keep the
// order this browser had saved, otherwise the order of games that already have server content.
export function adoptedLineup(snapshot, storedPlan) {
  const unique = types => [...new Set(types)].filter(type => GAME_CATALOG[type]).slice(0, MAX_LINEUP)
  if (Array.isArray(storedPlan?.games)) return unique(storedPlan.games.map(game => game.type))
  const rounds = [
    ...(snapshot?.rounds || []).filter(round => round.game_type === 'guess_age'),
    snapshot?.perfect_lie?.round, snapshot?.i_bet_you?.round, snapshot?.no_context?.round,
  ].filter(Boolean)
  return unique(rounds.sort((a, b) => (a.position || 99) - (b.position || 99)).map(round => TYPE_FOR_GAME_TYPE[round.game_type]))
}

// Hosting mode needs one game. Games still being set up do not block it (teams can join
// meanwhile); each game cannot start until its own setup is complete.
export function nightStartCheck(games) {
  if (!games.length) return { canStart: false, reason: 'Add at least one game to start the night.', blocking: [] }
  const blocking = games.filter(game => game.state === 'needs_setup')
  return { canStart: true, reason: blocking.length ? `${blocking.map(game => GAME_CATALOG[game.type].name).join(' and ')} still ${blocking.length === 1 ? 'needs' : 'need'} setting up before ${blocking.length === 1 ? 'it starts' : 'they start'}.` : '', blocking }
}

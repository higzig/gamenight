export const ROOM_PATTERN = /^[A-Z0-9]{6}$/

export function normalizeRoom(value = '') {
  return value.trim().toUpperCase()
}

export async function ensureAnonymousSession(client) {
  const { data: current, error: sessionError } = await client.auth.getSession()
  if (sessionError) throw sessionError
  if (current.session?.user?.is_anonymous) return current.session
  if (current.session) await client.auth.signOut()
  const { data, error } = await client.auth.signInAnonymously()
  if (error) throw error
  return data.session
}

export async function hydrateTeam(client, roomCode) {
  const { data, error } = await client.rpc('get_team_room_state', { p_room_code: roomCode })
  if (error) throw error
  return data
}

export async function joinTeam(client, roomCode, teamName) {
  const { error } = await client.rpc('join_event', {
    p_room_code: roomCode,
    p_team_name: teamName.trim(),
  })
  if (error) throw error
  return hydrateTeam(client, roomCode)
}

export async function submitGuess(client, teamId, questionId, guess) {
  const { data, error } = await client.rpc('submit_guess', { p_team_id: teamId, p_question_id: questionId, p_guess: guess })
  if (error) throw error
  return data
}

export function secondsRemaining(state, now = Date.now()) {
  const deadline = Date.parse(state?.event?.question_deadline_at || '')
  const serverNow = Date.parse(state?.server_now || '')
  const hydratedAt = state?._hydratedAt || now
  if (!Number.isFinite(deadline) || !Number.isFinite(serverNow)) return 0
  return Math.max(0, Math.ceil((deadline - serverNow - (now - hydratedAt)) / 1000))
}

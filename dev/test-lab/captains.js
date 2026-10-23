import { createClient } from '@supabase/supabase-js'
import { hydrateJoinRoom, hydrateTeam, joinTeam } from '../../src/team-service.js'
import { MASCOTS } from '../../src/mascots.js'
import { normalizeTeamName } from '../../src/team-join.js'
import { TEAM_NAMES } from './content.js'

const POOL_KEY = 'gameNightTestLab:captainPool'
const SIMULATED = 'game_night_test_lab'
const clients = new Map()

export const isSimulatedUser = user => user?.is_anonymous === true && user?.user_metadata?.[SIMULATED] === true

export function readPool(storage = localStorage) {
  try { return JSON.parse(storage.getItem(POOL_KEY)) || [] } catch { return [] }
}
function writePool(pool, storage = localStorage) { storage.setItem(POOL_KEY, JSON.stringify(pool)) }

// Each simulated Captain has its own client and its own persisted anonymous session.
export function captainClient(entry, { url, key }) {
  if (!clients.has(entry.storageKey)) clients.set(entry.storageKey, createClient(url, key, { auth: { storageKey: entry.storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }))
  return clients.get(entry.storageKey)
}

// Reuse the saved session; sign in anonymously (tagged as simulated) only when there is none.
export async function ensureCaptainSession(client) {
  const { data } = await client.auth.getSession()
  if (isSimulatedUser(data.session?.user)) return { user: data.session.user, created: false }
  if (data.session) await client.auth.signOut({ scope: 'local' })
  const { data: signed, error } = await client.auth.signInAnonymously({ options: { data: { [SIMULATED]: true } } })
  if (error) throw error
  return { user: signed.user, created: true }
}

export const savedSessionCount = (storage = localStorage) => readPool(storage).filter(entry => storage.getItem(entry.storageKey)).length

export function uniqueTeamName(taken, random = Math.random) {
  const used = new Set(taken.map(normalizeTeamName))
  const free = TEAM_NAMES.filter(name => !used.has(normalizeTeamName(name)))
  if (free.length) return free[Math.floor(random() * free.length)]
  for (let n = 2; ; n += 1) { const name = `${TEAM_NAMES[Math.floor(random() * TEAM_NAMES.length)]} ${n}`; if (!used.has(normalizeTeamName(name))) return name }
}

// The pool Captains that already have a team in this project.
export async function joinedCaptains(roomCode, env, storage = localStorage) {
  const joined = []
  for (const [index, entry] of readPool(storage).entries()) {
    if (!storage.getItem(entry.storageKey)) continue
    const client = captainClient(entry, env)
    const { data } = await client.auth.getSession()
    if (!isSimulatedUser(data.session?.user)) continue
    const state = await hydrateTeam(client, roomCode).catch(() => null)
    if (state?.team) joined.push({ index, entry, client, teamId: state.team.id, teamName: state.team.name })
  }
  return joined
}

// Bring this project up to `target` simulated teams. Existing simulated teams count towards it,
// so generating again never duplicates teams. Joining uses the normal Captain registration RPC.
export async function generateTeams({ roomCode, target, env, log, storage = localStorage, random = Math.random }) {
  let joined = await joinedCaptains(roomCode, env, storage)
  const pool = readPool(storage), result = { created: 0, reused: 0, joined: 0 }
  const room = await hydrateJoinRoom(env.anyClient, roomCode)
  if (!room?.event) throw new Error('Project room not found.')
  const names = (room.lobby_roster || []).map(team => team.name), mascots = new Set(room.taken_mascot_ids || [])
  for (let index = 0; joined.length < target; index += 1) {
    if (index >= pool.length) pool.push({ storageKey: `gameNightTestLab:captain:${crypto.randomUUID()}` })
    writePool(pool, storage)
    if (joined.some(item => item.index === index)) continue
    const entry = pool[index], client = captainClient(entry, env)
    const session = await ensureCaptainSession(client)
    result[session.created ? 'created' : 'reused'] += 1
    const existing = await hydrateTeam(client, roomCode).catch(() => null)
    if (existing?.team) { joined.push({ index, entry, client, teamId: existing.team.id, teamName: existing.team.name }); continue }
    const mascot = MASCOTS.find(item => !mascots.has(item.id))
    if (!mascot) { log('No mascots left: a project can have at most 32 teams.', 'warn'); break }
    const name = uniqueTeamName(names, random)
    const state = await joinTeam(client, roomCode, name, mascot.id)
    if (!state?.team) throw new Error(`${name} could not join.`)
    names.push(state.team.name); mascots.add(state.team.mascot_id)
    joined.push({ index, entry, client, teamId: state.team.id, teamName: state.team.name })
    result.joined += 1
    log(`${state.team.name} joined.`)
  }
  return { ...result, captains: joined }
}

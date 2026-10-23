// Vite dev-server plugin for Game Night Test Lab. `apply: 'serve'` means it never exists in a build.
// It holds the only privileged operation (removing simulator-created teams) and keeps the local
// database connection on the server: credentials are never sent to browser code.
import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hostnameOf = value => { try { return new URL(value).hostname } catch { return '' } }

// Reject anything that is not a same-origin request from this machine carrying this server's token.
export function requestProblem(req, token) {
  if (!LOOPBACK.has(req.socket?.remoteAddress)) return [403, 'Test Lab only accepts requests from this machine.']
  const host = String(req.headers.host || '')
  if (!LOCAL.has(hostnameOf(`http://${host}`))) return [403, 'Unexpected Host header.']
  if (req.headers.origin !== `http://${host}`) return [403, 'Cross-origin requests are not allowed.']
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return [403, 'Cross-site requests are not allowed.']
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return [415, 'Expected JSON.']
  const sent = Buffer.from(String(req.headers['x-test-lab-token'] || '')), expected = Buffer.from(token)
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return [403, 'Missing or invalid Test Lab token.']
  return null
}

const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)) }
const readJson = req => new Promise((resolve, reject) => { let data = ''; req.on('data', chunk => { data += chunk; if (data.length > 10_000) reject(new Error('Body too large')) }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch (error) { reject(error) } }) })

let databaseUrl = null
async function localDatabaseUrl(cwd) {
  if (databaseUrl) return databaseUrl
  const { stdout } = await promisify(execFile)('npx', ['supabase', 'status', '-o', 'env'], { cwd })
  const url = stdout.match(/^DB_URL="?([^"\n]+)"?$/m)?.[1]
  if (!url || !LOCAL.has(hostnameOf(url))) throw new Error('Local Supabase database not found. Is `supabase start` running?')
  return (databaseUrl = url)
}

async function hostUser(authorization, { supabaseUrl, publishableKey }) {
  if (!/^Bearer [\w.-]+$/.test(String(authorization || ''))) return null
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: publishableKey, Authorization: authorization } })
  if (!response.ok) return null
  const user = await response.json()
  return user?.id && !user.is_anonymous ? user : null
}

// Before any game has been on stage there are no answers, votes or points to disturb, so
// deleting simulated teams is clean. After that it would change other teams' results, so refuse.
export const REMOVE_SIMULATED_TEAMS_SQL = {
  lock: `select e.id, e.host_id,
      exists(select 1 from private.game_checkpoints c where c.event_id=e.id)
      or (e.active_round_id is not null and e.status not in ('draft','lobby'))
      or exists(select 1 from public.score_awards a where a.event_id=e.id)
      or exists(select 1 from public.submissions s where s.event_id=e.id)
      or exists(select 1 from public.perfect_lie_responses r where r.event_id=e.id)
      or exists(select 1 from public.no_context_plays p where p.event_id=e.id and p.phase<>'ready')
      or exists(select 1 from public.i_bet_you_group_members m where m.event_id=e.id) as played
    from public.events e where e.id=$1 for update`,
  remove: `delete from public.teams t using auth.users u
    where t.event_id=$1 and u.id=t.auth_user_id and u.is_anonymous and u.raw_user_meta_data->>'game_night_test_lab'='true'
    returning t.name`,
  notify: `update public.events set state_version=state_version+1 where id=$1 returning state_version`,
}

export async function removeSimulatedTeams({ client, projectId, hostId }) {
  await client.query('begin')
  try {
    const { rows: [event] } = await client.query(REMOVE_SIMULATED_TEAMS_SQL.lock, [projectId])
    if (!event) { await client.query('rollback'); return [404, { error: 'Project not found.' }] }
    if (event.host_id !== hostId) { await client.query('rollback'); return [403, { error: 'That project belongs to another Host.' }] }
    if (event.played) { await client.query('rollback'); return [409, { error: 'A game in this project has already been on stage, so simulated teams can no longer be removed without changing other teams’ answers, votes or points. Delete the whole test project instead.' }] }
    const { rows } = await client.query(REMOVE_SIMULATED_TEAMS_SQL.remove, [projectId])
    if (rows.length) {
      const { rows: [{ state_version: version }] } = await client.query(REMOVE_SIMULATED_TEAMS_SQL.notify, [projectId])
      await client.query('select private.notify_event($1,$2,$3)', [projectId, version, 'test_lab_teams_removed'])
    }
    await client.query('commit')
    return [200, { removed: rows.map(row => row.name) }]
  } catch (error) { await client.query('rollback').catch(() => {}); throw error }
}

export function testLabDevServer({ supabaseUrl, publishableKey, root }) {
  const token = randomBytes(24).toString('hex')
  return {
    name: 'game-night-test-lab',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path === '/dev/test-lab') { res.statusCode = 302; res.setHeader('Location', '/dev/test-lab/'); return res.end() }
        if (path === '/__test-lab/token' && req.method === 'GET') {
          // Same-origin only: no CORS headers are sent, so other sites cannot read the token.
          const localHost = LOCAL.has(hostnameOf(`http://${req.headers.host || ''}`))
          if (!LOOPBACK.has(req.socket?.remoteAddress) || !localHost || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return send(res, 403, { error: 'Forbidden' })
          return send(res, 200, { token })
        }
        if (path !== '/__test-lab/remove-simulated-teams') return next()
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' })
        const problem = requestProblem(req, token)
        if (problem) return send(res, problem[0], { error: problem[1] })
        if (!LOCAL.has(hostnameOf(supabaseUrl))) return send(res, 403, { error: 'Test Lab only works with local Supabase.' })
        let client
        try {
          const { projectId } = await readJson(req)
          if (!UUID.test(String(projectId))) return send(res, 400, { error: 'Choose a project.' })
          const user = await hostUser(req.headers.authorization, { supabaseUrl, publishableKey })
          if (!user) return send(res, 401, { error: 'Sign in to Host Studio first.' })
          const { default: pg } = await import('pg')
          client = new pg.Client({ connectionString: await localDatabaseUrl(root) })
          await client.connect()
          const [status, body] = await removeSimulatedTeams({ client, projectId, hostId: user.id })
          send(res, status, body)
        } catch (error) {
          server.config.logger.error(`[test-lab] ${error.message}`)
          send(res, 500, { error: 'Cleanup failed. Nothing was changed.' })
        } finally { await client?.end().catch(() => {}) }
      })
    },
  }
}

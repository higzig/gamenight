import { describe, expect, it, vi } from 'vitest'
import { removeSimulatedTeams, requestProblem } from './test-lab-plugin.mjs'

const request = (headers = {}, remoteAddress = '127.0.0.1') => ({ socket: { remoteAddress }, headers: { host: 'localhost:5173', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-test-lab-token': 'secret-token', ...headers } })
describe('Cleanup endpoint request checks', () => {
  it('accepts a same-origin local request with the token', () => expect(requestProblem(request(), 'secret-token')).toBeNull())
  it.each([
    ['another machine', request({}, '192.168.1.5')],
    ['a forged Host header (DNS rebinding)', request({ host: 'evil.example:5173', origin: 'http://evil.example:5173' })],
    ['a cross-origin page', request({ origin: 'http://evil.example' })],
    ['a missing Origin', request({ origin: undefined })],
    ['a cross-site fetch', request({ 'sec-fetch-site': 'cross-site' })],
    ['a form post', request({ 'content-type': 'application/x-www-form-urlencoded' })],
    ['a missing token', request({ 'x-test-lab-token': '' })],
    ['a wrong token', request({ 'x-test-lab-token': 'secret-tokeX' })],
  ])('rejects %s', (_label, req) => expect(requestProblem(req, 'secret-token')).not.toBeNull())
})

describe('Removing simulated teams', () => {
  const db = event => { const query = vi.fn(async sql => sql.startsWith('select e.id') ? { rows: event ? [event] : [] } : sql.startsWith('delete') ? { rows: [{ name: 'Sim A' }, { name: 'Sim B' }] } : sql.startsWith('update') ? { rows: [{ state_version: 9 }] } : { rows: [] }); return { query } }
  const statements = client => client.query.mock.calls.map(([sql]) => sql.split(/\s+/)[0])
  it('removes only simulator-tagged teams in an unplayed project and notifies screens', async () => {
    const client = db({ id: 'p', host_id: 'h', played: false })
    expect(await removeSimulatedTeams({ client, projectId: 'p', hostId: 'h' })).toEqual([200, { removed: ['Sim A', 'Sim B'] }])
    const remove = client.query.mock.calls.find(([sql]) => sql.startsWith('delete'))[0]
    expect(remove).toContain("raw_user_meta_data->>'game_night_test_lab'='true'"); expect(remove).toContain('t.event_id=$1')
    expect(statements(client)).toEqual(['begin', 'select', 'delete', 'update', 'select', 'commit'])
  })
  it('refuses once a game has been on stage, changing nothing', async () => {
    const client = db({ id: 'p', host_id: 'h', played: true })
    const [status, body] = await removeSimulatedTeams({ client, projectId: 'p', hostId: 'h' })
    expect(status).toBe(409); expect(body.error).toContain('Delete the whole test project'); expect(statements(client)).toEqual(['begin', 'select', 'rollback'])
  })
  it('refuses another Host’s project and unknown projects', async () => {
    expect((await removeSimulatedTeams({ client: db({ id: 'p', host_id: 'other', played: false }), projectId: 'p', hostId: 'h' }))[0]).toBe(403)
    expect((await removeSimulatedTeams({ client: db(null), projectId: 'p', hostId: 'h' }))[0]).toBe(404)
  })
})

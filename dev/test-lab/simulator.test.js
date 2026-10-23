import { describe, expect, it, vi } from 'vitest'
import { actionDelay, actionRequest, ageGuess, chooseVote, createSimulator, describeStage, hostHints, isActive, plannedActions, retryable } from './simulator.js'

const now = Date.parse('2026-10-23T20:00:00Z')
const base = (extra = {}) => ({ server_now: new Date(now).toISOString(), _hydratedAt: now, team: { id: 't1' }, event: { active_round_id: 'r', status: 'lobby' }, ...extra })
const inSeconds = s => new Date(now + s * 1000).toISOString()
const ga = (extra = {}) => base({ round: { id: 'r', game_type: 'guess_age' }, question: { id: 'q' }, event: { active_round_id: 'r', status: 'question', accepting_answers: true, question_deadline_at: inSeconds(15) }, ...extra })
const nc = (play, extra = {}) => base({ no_context: { round: { id: 'r' }, play: { id: 'p', ballot: 0, deadline_at: inSeconds(30), ...play }, participating: true, options: [{ id: 'o1', is_own: false }, { id: 'mine', is_own: true }], ...extra } })
const tl = (phase, extra = {}) => base({ event: { active_round_id: 'r', status: 'question', question_deadline_at: inSeconds(20) }, perfect_lie: { round: { id: 'r', phase }, question: { id: 'q' }, options: [{ id: 'truth', text: 'Bees', is_own: false }, { id: 'lie', text: 'Wasps', is_own: false }, { id: 'own', text: 'Mine', is_own: true }], ...extra } })

describe('What a simulated Captain may do', () => {
  it('guesses once while the Guess the Age window is open, and never after it closes', () => {
    expect(plannedActions(ga(), { now })).toEqual([{ key: 'ga:q', kind: 'guess', remainingMs: 15000 }])
    expect(plannedActions(ga({ submission: { guess_integer: 30 } }), { now })).toEqual([])
    expect(plannedActions(ga(), { now: now + 16000 })).toEqual([])
    expect(plannedActions(ga({ event: { active_round_id: 'r', status: 'suspense', accepting_answers: false } }), { now })).toEqual([])
  })
  it('does nothing while the game is paused', () => {
    expect(plannedActions({ ...ga(), game_paused: true }, { now })).toEqual([])
    expect(plannedActions({ ...nc({ phase: 'responses' }), game_paused: true }, { now })).toEqual([])
  })
  it('responds and votes in No Context only when eligible', () => {
    expect(plannedActions(nc({ phase: 'responses' }), { now }).map(a => a.kind)).toEqual(['ncResponse'])
    expect(plannedActions(nc({ phase: 'responses' }, { participating: false }), { now })).toEqual([])
    expect(plannedActions(nc({ phase: 'voting', ballot: 2 }), { now })).toEqual([{ key: 'nc:vote:p:2', kind: 'ncVote', remainingMs: 30000 }])
    expect(plannedActions(nc({ phase: 'voting' }, { options: [{ id: 'mine', is_own: true }] }), { now })).toEqual([])
    expect(plannedActions(nc({ phase: 'voting' }, { my_vote: 'o1' }), { now })).toEqual([])
  })
  it('answers, then lies, then votes in Table of Lies', () => {
    expect(plannedActions(tl('writing'), { now }).map(a => a.kind)).toEqual(['tlAnswer'])
    expect(plannedActions(tl('writing', { my_response: { knew_truth: false } }), { now }).map(a => a.kind)).toEqual(['tlLie'])
    expect(plannedActions(tl('writing'), { now: now + 25000 }).map(a => a.kind)).toEqual(['tlLie'])
    expect(plannedActions(tl('writing', { my_response: {}, my_lie: { id: 'l' } }), { now })).toEqual([])
    expect(plannedActions(tl('voting'), { now }).map(a => a.kind)).toEqual(['tlVote'])
  })
  it('stays passive in I Bet You', () => {
    expect(plannedActions(base({ i_bet_you: { round: { id: 'r' } } }), { now })).toEqual([])
  })
})

describe('Simulated content', () => {
  it('mixes accurate, slightly wrong and wildly wrong guesses within the allowed range', () => {
    let seed = 7; const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
    const guesses = Array.from({ length: 300 }, () => ageGuess(40, random))
    expect(guesses.every(g => g >= 1 && g <= 120)).toBe(true)
    expect(guesses.some(g => Math.abs(g - 40) <= 1)).toBe(true)
    expect(guesses.some(g => Math.abs(g - 40) >= 2 && Math.abs(g - 40) <= 6)).toBe(true)
    expect(guesses.some(g => Math.abs(g - 40) >= 15)).toBe(true)
  })
  it('never votes for its own option', () => {
    for (let i = 0; i < 50; i++) expect(chooseVote([{ id: 'a', is_own: true }, { id: 'b' }, { id: 'c' }], { index: i }).id).not.toBe('a')
    expect(chooseVote([{ id: 'a', is_own: true }])).toBeNull()
  })
  it('spreads votes to force ties when asked', () => {
    const options = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect([0, 1, 2, 3].map(index => chooseVote(options, { tieSpread: true, index }).id)).toEqual(['a', 'b', 'a', 'b'])
  })
  it('finds the truth by text when choosing to vote for it', () => {
    expect(chooseVote(tl('voting').perfect_lie.options, { truthText: 'bees.', accuracy: 1, random: () => 0 }).id).toBe('truth')
  })
  it('builds the real Captain RPC for each action', () => {
    expect(actionRequest({ kind: 'guess' }, ga(), { hints: { correctAge: 50 }, random: () => 0.1 })).toMatchObject({ rpc: 'submit_guess', args: { p_team_id: 't1', p_question_id: 'q' } })
    expect(actionRequest({ kind: 'ncVote' }, nc({ phase: 'voting', ballot: 1 }), {}).args).toMatchObject({ p_response_id: 'o1', p_ballot: 1 })
    expect(actionRequest({ kind: 'tlLie' }, tl('writing'), { hints: { truth: 'Exactly 47' }, index: 0, attempt: 0 }).args.p_lie).not.toBe('Exactly 47')
  })
  it('retries only a rejected lie', () => {
    expect(retryable({ kind: 'tlLie' }, { code: '23505' })).toBe(true)
    expect(retryable({ kind: 'guess' }, { code: '23505' })).toBe(false)
  })
})

describe('Timing and modes', () => {
  it('stays inside the remaining server time and scales with speed', () => {
    for (const speed of ['fast', 'normal', 'slow']) for (const r of [0, 0.5, 0.999]) {
      const delay = actionDelay({ remainingMs: 15000, speed, random: () => r })
      expect(delay).toBeGreaterThan(0); expect(delay).toBeLessThan(15000)
    }
    expect(actionDelay({ remainingMs: 15000, speed: 'fast', random: () => 0.5 })).toBeLessThan(actionDelay({ remainingMs: 15000, speed: 'slow', random: () => 0.5 }))
  })
  it('keeps a stable share of teams inactive in Mixed mode, none in Automatic, all in Manual', () => {
    const indexes = Array.from({ length: 20 }, (_, i) => i)
    const active = indexes.filter(i => isActive(i, 'mixed', 0.3)).length
    expect(active).toBeGreaterThanOrEqual(11); expect(active).toBeLessThanOrEqual(17)
    expect(indexes.filter(i => isActive(i, 'mixed', 0.3))).toEqual(indexes.filter(i => isActive(i, 'mixed', 0.3)))
    expect(indexes.every(i => isActive(i, 'automatic'))).toBe(true); expect(indexes.some(i => isActive(i, 'manual'))).toBe(false)
  })
  it('reads hints only from the Host snapshot', () => {
    expect(hostHints({ event: { active_question_id: 'q', event_date: '2026-10-23' }, rounds: [{ questions: [{ id: 'q', date_of_birth: '1975-04-02' }] }] }).correctAge).toBe(51)
    expect(hostHints({ event: {}, perfect_lie: { round: { active_question_id: 'x' }, categories: [{ questions: [{ id: 'x', correct_answer: 'Bees' }] }] } }).truth).toBe('Bees')
  })
  it('describes the current game and participation', () => {
    expect(describeStage({ event: { active_round_id: 'nc' }, teams: [], no_context: { round: { id: 'nc' }, play: { number: 2, phase: 'voting' }, vote_count: 3, eligible_count: 9 } })).toEqual({ game: 'No Context', phase: 'Round 2/5 · voting', progress: '3/9 voted' })
  })
})

describe('Simulation engine', () => {
  const fakeTimers = () => {
    const queue = new Map(); let id = 0
    return { setTimeout: (fn, ms) => { queue.set(++id, { fn, ms }); return id }, clearTimeout: t => queue.delete(t), setInterval: () => 0, clearInterval: () => {}, queue, runAll: async () => { for (const [t, { fn }] of [...queue]) { queue.delete(t); await fn() } } }
  }
  const setup = (state, host = { event: { active_round_id: 'r' } }) => {
    const timers = fakeTimers(), rpc = vi.fn().mockResolvedValue({ error: null }), logs = []
    let current = state, currentHost = host
    const captains = [0, 1, 2].map(index => ({ index, teamName: `T${index}`, client: { rpc } }))
    const engine = createSimulator({ captains, hydrateCaptain: async () => structuredClone({ ...current, _hydratedAt: Date.now(), server_now: new Date().toISOString() }), hydrateHost: async () => currentHost, subscribe: async () => () => {}, getSettings: () => ({ mode: 'automatic', speed: 'fast' }), log: text => logs.push(text), onStage: () => {}, timers, random: () => 0.5 })
    return { timers, rpc, logs, engine, setState: s => { current = s }, setHost: h => { currentHost = h } }
  }
  const openGuess = () => { const s = ga(); s.event.question_deadline_at = new Date(Date.now() + 15000).toISOString(); return s }
  it('staggers one action per Captain and submits through the Captain client', async () => {
    const { engine, timers, rpc } = setup(openGuess())
    await engine.start()
    expect(timers.queue.size).toBe(3)
    await engine.refresh(); expect(timers.queue.size).toBe(3)
    await timers.runAll()
    expect(rpc).toHaveBeenCalledTimes(3); expect(rpc.mock.calls[0][0]).toBe('submit_guess')
  })
  it('cancels pending actions on pause and schedules again after resume', async () => {
    const { engine, timers, rpc, setHost, logs } = setup(openGuess())
    await engine.start(); expect(timers.queue.size).toBe(3)
    setHost({ event: { active_round_id: 'r' }, game_pause: { selected_paused: true } }); await engine.refresh()
    expect(timers.queue.size).toBe(0); expect(rpc).not.toHaveBeenCalled(); expect(logs.some(l => l.startsWith('Game paused'))).toBe(true)
    setHost({ event: { active_round_id: 'r' } }); await engine.refresh(); expect(timers.queue.size).toBe(3)
  })
  it('stops cleanly: pending actions are cancelled and nothing more is sent', async () => {
    const { engine, timers, rpc } = setup(openGuess())
    await engine.start(); engine.stop()
    expect(timers.queue.size).toBe(0); await timers.runAll(); expect(rpc).not.toHaveBeenCalled()
  })
  it('skips an action whose phase has ended by the time it runs', async () => {
    const { engine, timers, rpc, setState } = setup(openGuess())
    await engine.start(); setState(ga({ submission: { guess_integer: 4 } })); await timers.runAll()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('logs a server rejection and does not retry it', async () => {
    const { engine, timers, rpc, logs } = setup(openGuess())
    rpc.mockResolvedValue({ error: { code: 'P0001', message: 'answer deadline has passed' } })
    await engine.start(); await timers.runAll(); await engine.refresh()
    expect(logs.filter(l => l.includes('rejected: answer deadline has passed'))).toHaveLength(3); expect(timers.queue.size).toBe(0)
  })
})

import { LIES, NO_CONTEXT_CAPTIONS, WRONG_ANSWERS } from './content.js'

// How much of a phase's remaining time simulated teams spread their actions over.
export const SPEEDS = {
  fast: { timed: [0.04, 0.3], untimed: [600, 4000] },
  normal: { timed: [0.15, 0.65], untimed: [2000, 12000] },
  slow: { timed: [0.4, 0.9], untimed: [6000, 25000] },
}

const between = (random, [low, high]) => low + random() * (high - low)

export function actionDelay({ remainingMs, speed = 'normal', random = Math.random }) {
  const profile = SPEEDS[speed] || SPEEDS.normal
  if (remainingMs == null) return Math.round(between(random, profile.untimed))
  return Math.max(250, Math.min(remainingMs - 750, Math.round(remainingMs * between(random, profile.timed))))
}

// Mixed mode: a stable subset of Captains stays inactive (same teams every refresh).
export function isActive(index, mode, inactiveShare = 0.3) {
  if (mode === 'manual') return false
  if (mode !== 'mixed') return true
  return ((index * 7919) % 100) / 100 >= inactiveShare
}

export function ageGuess(correctAge, random = Math.random) {
  const roll = random(), sign = random() < 0.5 ? -1 : 1
  const offset = roll < 0.3 ? Math.round(random()) : roll < 0.7 ? 2 + Math.floor(random() * 5) : 15 + Math.floor(random() * 26)
  const base = Number.isFinite(correctAge) ? correctAge : 30 + Math.floor(random() * 30)
  return Math.min(120, Math.max(1, base + sign * offset))
}

export const normalize = value => String(value || '').trim().toLowerCase().replace(/[.!?,;:]+$/, '').replace(/\s+/g, ' ')

// Never the team's own option. tieSpread rotates votes so groups of options get equal votes.
export function chooseVote(options = [], { random = Math.random, truthText = null, accuracy = 0.5, tieSpread = false, index = 0 } = {}) {
  const eligible = options.filter(option => !option.is_own)
  if (!eligible.length) return null
  if (tieSpread) return eligible[index % Math.min(2, eligible.length)]
  const truth = truthText != null ? eligible.find(option => normalize(option.text) === normalize(truthText)) : null
  if (truth && random() < accuracy) return truth
  const others = eligible.filter(option => option !== truth)
  return (others.length ? others : eligible)[Math.floor(random() * (others.length || eligible.length))]
}

const remaining = (deadline, state, now) => {
  const due = Date.parse(deadline || ''), server = Date.parse(state?.server_now || '')
  if (!Number.isFinite(due) || !Number.isFinite(server)) return null
  return due - server - (now - (state._hydratedAt ?? now))
}

export function activeGame(state) {
  const roundId = state?.event?.active_round_id
  if (!roundId) return null
  if (state.no_context?.round?.id === roundId) return 'noContext'
  if (state.perfect_lie?.round?.id === roundId) return 'perfectLie'
  if (state.i_bet_you?.round?.id === roundId) return 'iBetYou'
  if (state.round?.id === roundId && state.round.game_type === 'guess_age') return 'guessAge'
  return null
}

// What this Captain could legitimately do right now, from its own Captain-facing state only.
// Keys make each action happen at most once; remainingMs is the server deadline left (null if untimed).
export function plannedActions(state, { now = Date.now() } = {}) {
  if (!state?.team || state.game_paused) return []
  const game = activeGame(state), actions = []
  if (game === 'guessAge') {
    const left = remaining(state.event.question_deadline_at, state, now)
    if (state.event.status === 'question' && state.event.accepting_answers && state.question && !state.submission && left > 0) actions.push({ key: `ga:${state.question.id}`, kind: 'guess', remainingMs: left })
  }
  if (game === 'noContext') {
    const { play, participating, my_response: response, my_vote: vote, options = [] } = state.no_context
    const left = remaining(play.deadline_at, state, now)
    if (play.phase === 'responses' && participating && !response && left > 0) actions.push({ key: `nc:response:${play.id}`, kind: 'ncResponse', remainingMs: left })
    if (['voting', 'tiebreak'].includes(play.phase) && participating && !vote && left > 0 && options.some(option => !option.is_own)) actions.push({ key: `nc:vote:${play.id}:${play.ballot}`, kind: 'ncVote', remainingMs: left })
  }
  if (game === 'perfectLie') {
    const game = state.perfect_lie, question = game.question
    if (question && game.round.phase === 'writing') {
      const left = remaining(state.event.question_deadline_at, state, now)
      if (!game.my_response && left > 0) actions.push({ key: `tl:answer:${question.id}`, kind: 'tlAnswer', remainingMs: left })
      else if (!game.my_lie) actions.push({ key: `tl:lie:${question.id}`, kind: 'tlLie', remainingMs: null })
    }
    if (question && game.round.phase === 'voting' && !game.my_vote && (game.options || []).some(option => !option.is_own)) actions.push({ key: `tl:vote:${question.id}`, kind: 'tlVote', remainingMs: null })
  }
  return actions
}

const pick = (list, random) => list[Math.floor(random() * list.length)]

// The legitimate Captain RPC for each action. hints come from the Host's own session and only
// shape the content of a submission; the server still decides whether it is accepted.
export function actionRequest(action, state, { hints = {}, random = Math.random, index = 0, settings = {}, attempt = 0 } = {}) {
  const teamId = state.team.id
  if (action.kind === 'guess') {
    const guess = ageGuess(hints.correctAge, random)
    return { rpc: 'submit_guess', args: { p_team_id: teamId, p_question_id: state.question.id, p_guess: guess }, label: `guessed ${guess}` }
  }
  if (action.kind === 'ncResponse') {
    const text = NO_CONTEXT_CAPTIONS[(index + attempt * 7) % NO_CONTEXT_CAPTIONS.length]
    return { rpc: 'submit_no_context_response', args: { p_team_id: teamId, p_play_id: state.no_context.play.id, p_response: text }, label: 'submitted a response' }
  }
  if (action.kind === 'ncVote') {
    const option = chooseVote(state.no_context.options, { random, tieSpread: settings.forceTie, index })
    return option && { rpc: 'submit_no_context_vote', args: { p_team_id: teamId, p_play_id: state.no_context.play.id, p_response_id: option.id, p_ballot: state.no_context.play.ballot }, label: 'voted' }
  }
  if (action.kind === 'tlAnswer') {
    const knows = hints.truth && random() < (settings.accuracy ?? 0.35)
    return { rpc: 'submit_perfect_lie_answer', args: { p_team_id: teamId, p_question_id: state.perfect_lie.question.id, p_answer: knows ? hints.truth : pick(WRONG_ANSWERS, random) }, label: knows ? 'answered (correct)' : 'answered' }
  }
  if (action.kind === 'tlLie') {
    let lie = LIES[(index * 3 + attempt * 5) % LIES.length]
    if (hints.truth && normalize(lie) === normalize(hints.truth)) lie = `${lie}, probably`
    return { rpc: 'submit_perfect_lie_lie', args: { p_team_id: teamId, p_question_id: state.perfect_lie.question.id, p_lie: lie }, label: 'wrote a lie' }
  }
  if (action.kind === 'tlVote') {
    const option = chooseVote(state.perfect_lie.options, { random, truthText: hints.truth, accuracy: settings.accuracy ?? 0.35 })
    return option && { rpc: 'submit_perfect_lie_vote', args: { p_team_id: teamId, p_question_id: state.perfect_lie.question.id, p_option_id: option.id }, label: 'voted' }
  }
  return null
}

// Only a duplicate lie is worth retrying with different content; everything else is final.
export const retryable = (action, error) => action.kind === 'tlLie' && ['23505', '22023'].includes(error?.code)

export function hostHints(hostSnapshot) {
  const hints = {}, event = hostSnapshot?.event
  const question = (hostSnapshot?.rounds || []).flatMap(round => round.questions || []).find(q => q.id === event?.active_question_id)
  if (question?.date_of_birth && event?.event_date) hints.correctAge = ageOn(question.date_of_birth, event.event_date)
  const lie = hostSnapshot?.perfect_lie, active = lie?.round?.active_question_id
  const truth = (lie?.categories || []).flatMap(category => category.questions || []).find(q => q.id === active)?.correct_answer
  if (truth) hints.truth = truth
  return hints
}

export function ageOn(dob, onDate) {
  const [by, bm, bd] = dob.split('-').map(Number), [y, m, d] = onDate.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

// What the Test Lab shows as "current game and phase", from the Host snapshot.
export function describeStage(host) {
  const event = host?.event
  if (!event) return { game: null, phase: 'No project selected', progress: '' }
  const activeId = event.active_round_id, paused = host.game_pause?.selected_paused
  const teams = (host.teams || []).filter(team => team.status === 'active').length
  if (host.no_context?.round?.id === activeId) {
    const nc = host.no_context, voting = ['voting', 'tiebreak'].includes(nc.play.phase)
    return { game: 'No Context', phase: `${paused ? 'Paused · ' : ''}Round ${nc.play.number}/5 · ${nc.play.phase}`, progress: voting ? `${nc.vote_count}/${nc.eligible_count} voted` : `${nc.response_count}/${nc.team_count} responded` }
  }
  if (host.perfect_lie?.round?.id === activeId) {
    const tl = host.perfect_lie
    return { game: 'Table of Lies', phase: `${paused ? 'Paused · ' : ''}${tl.round.phase}`, progress: `${tl.answer_count}/${tl.team_count} answers · ${tl.lie_count} lies · ${tl.vote_count} votes` }
  }
  if (host.i_bet_you?.round?.id === activeId) return { game: 'I Bet You', phase: `${paused ? 'Paused · ' : ''}${host.i_bet_you.round.status}`, progress: 'Host-run game: Captains are passive' }
  if ((host.rounds || []).some(round => round.id === activeId)) {
    const answered = (host.submissions || []).filter(sub => sub.guess_integer != null).length
    return { game: 'Guess the Age', phase: `${paused ? 'Paused · ' : ''}${event.status}`, progress: `${answered}/${teams} guesses` }
  }
  return { game: null, phase: host.lineup?.started_at ? 'Hosting · no game on stage' : 'Planning', progress: `${teams} teams registered` }
}

// Runs simulated Captains against the real game. Each Captain uses its own client and session.
export function createSimulator({ captains, hydrateCaptain, hydrateHost, subscribe, getSettings, log, onStage, timers = globalThis, random = Math.random, pollMs = 2500 }) {
  const pending = new Map(), done = new Set(), attempts = new Map()
  let running = false, poll = null, unsubscribe = null, refreshing = null, again = false, lastStage = '', wasPaused = false, host = null
  const states = new Map()

  function cancelAll(reason) {
    if (pending.size && reason) log(`${reason} — cancelled ${pending.size} pending simulated action${pending.size === 1 ? '' : 's'}.`)
    for (const { timer } of pending.values()) timers.clearTimeout(timer)
    pending.clear()
  }

  // Actions are tracked per Captain: every team gets its own guess, response and vote.
  const slot = (captain, key) => `${captain.index}|${key}`

  async function execute(id, key, captain) {
    pending.delete(id)
    if (!running) return
    await refreshCaptain(captain)
    const state = states.get(captain.index)
    const action = plannedActions(state).find(item => item.key === key)
    if (!action) return
    const request = actionRequest(action, state, { hints: host ? hostHints(host) : {}, random, index: captain.index, settings: getSettings(), attempt: attempts.get(id) || 0 })
    if (!request) return
    const { error } = await captain.client.rpc(request.rpc, request.args)
    if (!running) return
    if (error) {
      const tries = (attempts.get(id) || 0) + 1
      attempts.set(id, tries)
      if (retryable(action, error) && tries < 4) { log(`${captain.teamName}'s lie was rejected (${error.message}). Trying another.`); schedule(captain, { ...action, remainingMs: null }); return }
      done.add(id); log(`${captain.teamName} was rejected: ${error.message}`, 'warn'); return
    }
    done.add(id); log(`${captain.teamName} ${request.label}.`)
  }

  function schedule(captain, action) {
    const id = slot(captain, action.key)
    if (pending.has(id) || done.has(id)) return
    const delay = actionDelay({ remainingMs: action.remainingMs, speed: getSettings().speed, random })
    pending.set(id, { timer: timers.setTimeout(() => execute(id, action.key, captain), delay), captain: captain.index })
  }

  async function refreshCaptain(captain) {
    const state = await hydrateCaptain(captain).catch(() => null)
    if (state) { state._hydratedAt = Date.now(); states.set(captain.index, state) }
    return state
  }

  async function refresh() {
    if (!running) return
    if (refreshing) { again = true; return refreshing }
    refreshing = (async () => {
      host = await hydrateHost().catch(() => host)
      const stage = describeStage(host), label = `${stage.game || ''}:${stage.phase}`
      if (label !== lastStage) { if (lastStage) log(stage.game ? `${stage.game} entered ${stage.phase}.` : `${stage.phase}.`); lastStage = label }
      onStage(stage)
      const paused = Boolean(host?.game_pause?.selected_paused)
      if (paused) { if (!wasPaused) cancelAll('Game paused'); wasPaused = true; return }
      if (wasPaused) log('Game resumed — simulated teams will continue.')
      wasPaused = false
      const settings = getSettings()
      await Promise.all(captains.map(refreshCaptain))
      for (const captain of captains) {
        if (!isActive(captain.index, settings.mode, settings.inactiveShare)) continue
        for (const action of plannedActions(states.get(captain.index))) schedule(captain, action)
      }
    })()
    try { await refreshing } finally { refreshing = null; if (again && running) { again = false; refresh() } }
  }

  return {
    async start() {
      if (running) return
      running = true
      log(`Simulation started: ${captains.length} Captains, ${getSettings().mode} mode, ${getSettings().speed} speed.`)
      unsubscribe = await subscribe(() => refresh())
      poll = timers.setInterval(() => refresh(), pollMs)
      await refresh()
    },
    stop() {
      if (!running) return
      running = false
      cancelAll('Simulation stopped')
      timers.clearInterval(poll); unsubscribe?.(); unsubscribe = null
      log('Simulation stopped. Existing submissions are unchanged.')
    },
    refresh,
    get running() { return running },
    get pendingCount() { return pending.size },
  }
}

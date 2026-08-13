export function teamJoinUrl(origin, roomCode) {
  const url = new URL('/team.html', origin)
  url.searchParams.set('room', roomCode)
  return url.href
}

export function audienceMode(state) {
  if (state?.event?.display_mode === 'join') return 'join'
  if (state?.event?.display_mode === 'leaderboard') return 'leaderboard'
  if (state?.event?.status === 'suspense') return 'suspense'
  if (state?.event?.status === 'reveal') return 'reveal'
  return state?.question ? 'question' : 'holding'
}

export function suspenseSeconds(state, now = Date.now()) {
  if (state?.event?.status !== 'suspense' || !state.event.question_reveal_due_at) return 0
  const serverNow = new Date(state.server_now).getTime()
  const due = new Date(state.event.question_reveal_due_at).getTime()
  return Math.max(0, Math.ceil((due - serverNow - (now - (state._hydratedAt ?? now))) / 1000))
}

export function revealOrder(age) {
  return String(age).split('').map((_, index, digits) => digits.length - 1 - index)
}

export async function animateAge({ age, target, reducedMotion = false, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const answer = String(age)
  const shown = Array(answer.length).fill('–')
  if (reducedMotion) { target.textContent = answer; return answer }
  for (const index of revealOrder(age)) {
    for (let step = 0; step < 10; step += 1) {
      shown[index] = String((Number(answer[index]) + step * 7 + 3) % 10)
      target.textContent = shown.join('')
      await sleep(40 + step * 12)
    }
    shown[index] = answer[index]
    target.textContent = shown.join('')
  }
  return target.textContent
}

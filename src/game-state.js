import { secondsRemaining } from './team-service.js'

export function canSubmitGuess(state, now = Date.now()) {
  return Boolean(
    state?.team && state?.question && !state?.submission &&
    state?.event?.status === 'question' && state.event.accepting_answers &&
    secondsRemaining(state, now) > 0
  )
}

export function authoritativeSubmissionCount(snapshot) {
  return (snapshot?.submissions || []).filter(item => item.guess_integer != null).length
}

export function teamRevealResult(state) {
  if (state?.event?.status !== 'reveal') return null
  return {
    correctAge: state?.question?.correct_age,
    guess: state?.submission?.guess_integer ?? null,
    points: state?.award?.points ?? 0,
    difference: state?.award?.metadata?.difference ?? null,
  }
}

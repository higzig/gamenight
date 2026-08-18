import { secondsRemaining } from './team-service.js'
export { secondsRemaining }

export function normalizeAudienceState(data) {
  if(!data)return data
  const raw=data.submitted_count??data.answer_count??0,count=Number(raw)
  data.submitted_count=Number.isFinite(count)?Math.max(0,count):0
  delete data.answer_count
  return data
}

export async function hydrateAudience(client, roomCode) {
  const { data, error } = await client.rpc('get_public_room_state', { p_room_code: roomCode })
  if (error) throw error
  if (data) data._hydratedAt = Date.now()
  return normalizeAudienceState(data)
}

export function containsSecretData(state) {
  const text = JSON.stringify(state || {})
  return text.includes('date_of_birth') || text.includes('question_secrets') || text.includes('source_reference') || text.includes('accepted_answer_variants') || (state?.event?.status !== 'reveal' && state?.question?.correct_age != null) || (!['reveal','question_complete'].includes(state?.perfect_lie?.round?.phase) && state?.perfect_lie?.question?.correct_answer != null)
}

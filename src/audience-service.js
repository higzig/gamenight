import { secondsRemaining } from './team-service.js'
export { secondsRemaining }

export async function hydrateAudience(client, roomCode) {
  const { data, error } = await client.rpc('get_public_room_state', { p_room_code: roomCode })
  if (error) throw error
  if (data) data._hydratedAt = Date.now()
  return data
}

export function containsSecretData(state) {
  const text = JSON.stringify(state || {})
  return text.includes('date_of_birth') || text.includes('question_secrets') || (state?.event?.status !== 'reveal' && state?.question?.correct_age != null)
}

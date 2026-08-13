export function isAnonymousUser(user) {
  return user?.is_anonymous === true
}

export async function listOwnedEvents(client) {
  const { data, error } = await client
    .from('events')
    .select('id,name,venue,event_date,room_code,status,created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createJoinableEvent(client, fields) {
  const { data: created, error: createError } = await client.rpc('create_event', {
    p_name: fields.name,
    p_venue: fields.venue,
    p_event_date: fields.eventDate,
    p_expected_teams: fields.expectedTeams,
  })
  if (createError) throw createError
  const { error: lobbyError } = await client.rpc('open_event_lobby', { p_event_id: created.id })
  if (lobbyError) throw lobbyError
  return created.id
}

export async function hydrateHostEvent(client, eventId) {
  const { data, error } = await client.rpc('get_host_event_state', { p_event_id: eventId })
  if (error) throw error
  if (!data) throw new Error('Event not found or access denied.')
  return data
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return data
}

export function saveGuessAgeRound(client, eventId, title, celebrities) {
  return rpc(client, 'save_guess_age_round', {
    p_event_id: eventId,
    p_title: title,
    p_questions: celebrities.map(celebrity => ({
      celebrity_name: celebrity.name,
      date_of_birth: celebrity.dob,
      external_image_url: celebrity.image?.startsWith('https://') ? celebrity.image : null,
    })),
  })
}

export function startRemoteQuestion(client, eventId, questionId) {
  return rpc(client, 'start_question', { p_event_id: eventId, p_question_id: questionId, p_duration_seconds: 15 })
}

export function lockRemoteQuestion(client, eventId) {
  return rpc(client, 'lock_question', { p_event_id: eventId })
}

export function revealRemoteQuestion(client, eventId) {
  return rpc(client, 'reveal_question', { p_event_id: eventId })
}

export function advanceRemoteQuestion(client, eventId) {
  return rpc(client, 'advance_guess_age_question', { p_event_id: eventId })
}

export function setRemoteDisplay(client, eventId, status) {
  return rpc(client, 'set_event_display', { p_event_id: eventId, p_status: status })
}

export function restartGuessAgeRound(client, eventId) {
  return rpc(client, 'restart_guess_age_round', { p_event_id: eventId })
}

export async function copyEventSession(client, eventId) {
  const event = await rpc(client, 'copy_event_session', { p_event_id: eventId })
  return event.id
}

export function reorderGuessAgeQuestion(client, eventId, questionId, direction) {
  return rpc(client, 'reorder_guess_age_question', { p_event_id: eventId, p_question_id: questionId, p_direction: direction })
}

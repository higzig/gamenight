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
  })
  if (createError) throw createError
  const { error: lobbyError } = await client.rpc('open_event_lobby', { p_event_id: created.id })
  if (lobbyError) throw lobbyError
  return created.id
}

export function deleteOwnedEvent(client, eventId) {
  return rpc(client, 'delete_event', { p_event_id: eventId })
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
      celebrity_id: celebrity.id ?? null,
      celebrity_name: celebrity.name,
      date_of_birth: celebrity.dob,
      image_path: celebrity.imagePath ?? null,
      external_image_url: celebrity.imageKind === 'external' || (!celebrity.imageKind && celebrity.image?.startsWith('https://')) ? celebrity.image : null,
      image_source: celebrity.imageSourceKind ?? null,
      source_reference: celebrity.sourceReference ?? null,
    })),
  })
}

export function searchCelebrityLibrary(client, query) {
  return rpc(client, 'search_celebrities', { p_query: query })
}

export function saveCelebrityRecord(client, celebrity) {
  return rpc(client, 'save_celebrity', {
    p_id: celebrity.id ?? null,
    p_display_name: celebrity.name,
    p_date_of_birth: celebrity.dob,
    p_image_kind: celebrity.imageKind ?? 'none',
    p_image_path: celebrity.imagePath ?? null,
    p_external_image_url: celebrity.imageKind === 'external' ? celebrity.image : null,
    p_image_source: celebrity.imageSourceKind ?? null,
    p_source_reference: celebrity.sourceReference ?? null,
  })
}

export async function uploadCelebrityImage(client, celebrityId, blob) {
  const path = `celebrities/${celebrityId}/${crypto.randomUUID()}.jpg`
  const { error } = await client.storage.from('celebrity-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  return path
}

export function markWikipediaChecked(client, celebrityId) {
  return rpc(client, 'mark_celebrity_wikipedia_checked', { p_id: celebrityId })
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

export const setupIBetYouRound = (client,eventId) => rpc(client,'setup_i_bet_you_round',{p_event_id:eventId})
export const swapIBetYouTeams = (client,eventId,teamA,teamB) => rpc(client,'swap_i_bet_you_teams',{p_event_id:eventId,p_team_a:teamA,p_team_b:teamB})
export const changeIBetYouCategory = (client,groupId) => rpc(client,'change_i_bet_you_category',{p_group_id:groupId})
export const setIBetYouBid = (client,groupId,bidderId,bid) => rpc(client,'set_i_bet_you_bid',{p_group_id:groupId,p_bidder_team_id:bidderId,p_bid:bid})
export const challengeIBetYou = (client,groupId,challengerId) => rpc(client,'challenge_i_bet_you',{p_group_id:groupId,p_challenger_team_id:challengerId})
export const correctIBetYouShowdown = (client,groupId,bidderId,challengerId,target) => rpc(client,'correct_i_bet_you_showdown',{p_group_id:groupId,p_bidder_team_id:bidderId,p_challenger_team_id:challengerId,p_target:target})
export const startIBetYouTimer = (client,groupId) => rpc(client,'start_i_bet_you_timer',{p_group_id:groupId})
export const judgeIBetYouGroup = (client,groupId,success) => rpc(client,'judge_i_bet_you_group',{p_group_id:groupId,p_success:success})
export const nextIBetYouGroup = (client,groupId) => rpc(client,'next_i_bet_you_group',{p_group_id:groupId})
export const resetIBetYouGroup = (client,groupId) => rpc(client,'reset_i_bet_you_group',{p_group_id:groupId})
export const activateHostedRound = (client,eventId,roundId) => rpc(client,'activate_hosted_round',{p_event_id:eventId,p_round_id:roundId})
export const savePerfectLieRound=(client,eventId,title,categories)=>rpc(client,'save_perfect_lie_round',{p_event_id:eventId,p_title:title,p_categories:categories})
export const startPerfectLieQuestion=(client,eventId,questionId)=>rpc(client,'start_perfect_lie_question',{p_event_id:eventId,p_question_id:questionId,p_duration_seconds:20})
export const closePerfectLieWriting=(client,eventId)=>rpc(client,'close_perfect_lie_writing',{p_event_id:eventId})
export const startPerfectLieReveal=(client,eventId)=>rpc(client,'start_perfect_lie_reveal',{p_event_id:eventId})
export const advancePerfectLieReveal=(client,eventId)=>rpc(client,'advance_perfect_lie_reveal',{p_event_id:eventId})
export const advancePerfectLieQuestion=(client,eventId,questionId=null)=>rpc(client,'advance_perfect_lie_question',{p_event_id:eventId,p_question_id:questionId})

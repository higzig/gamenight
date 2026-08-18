export function normalizeTeamName(value='') {
  return String(value).trim().replace(/\s+/g,' ').toLocaleLowerCase()
}

export function isTeamNameTaken(value,roster=[]) {
  const normalized=normalizeTeamName(value)
  return Boolean(normalized)&&roster.some(team=>normalizeTeamName(team.name)===normalized)
}

export function joinAvailability({name='',mascotId=null,takenMascotIds=[],roster=[]}={}) {
  const blank=!normalizeTeamName(name),nameTaken=isTeamNameTaken(name,roster),mascotTaken=Boolean(mascotId)&&takenMascotIds.includes(mascotId)
  return {blank,nameTaken,mascotTaken,canJoin:!blank&&!nameTaken&&Boolean(mascotId)&&!mascotTaken}
}

export function friendlyJoinError(error) {
  const message=String(error?.message||'').toLowerCase()
  if(message.includes('team name')&&message.includes('taken'))return 'That Team name is already taken.'
  if(message.includes('mascot')&&message.includes('taken'))return 'That mascot was just taken. Pick another one.'
  return 'Unable to join that room. Check the code or ask the Host.'
}

export function rosterPresentation(roster=[]) {
  return roster.map(team=>({name:team.name,mascot_id:team.mascot_id}))
}

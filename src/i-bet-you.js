export function activeIBetYouGroup(state) {
  const game = state?.i_bet_you
  return game?.groups?.find(group => group.id === game.round?.active_group_id) ?? null
}

export function teamName(group, teamId) {
  return group?.members?.find(member => member.team_id === teamId)?.name ?? 'Team'
}

export function adjustBid(value, delta) {
  return Math.min(100, Math.max(1, (Number(value) || 1) + delta))
}

export function iBetYouSecondsRemaining(state, now = Date.now()) {
  const group = activeIBetYouGroup(state)
  const deadline = Date.parse(group?.countdown_deadline_at ?? '')
  const serverNow = Date.parse(state?.server_now ?? '')
  const hydratedAt = state?._hydratedAt ?? now
  if (!Number.isFinite(deadline) || !Number.isFinite(serverNow)) return 0
  return Math.max(0, Math.ceil((deadline - serverNow - (now - hydratedAt)) / 1000))
}

export function groupForTeam(state, teamId) {
  return state?.i_bet_you?.groups?.find(group => group.members?.some(member => member.team_id === teamId)) ?? null
}

export function iBetYouAudienceModel(state, now = Date.now()) {
  const group = activeIBetYouGroup(state)
  if (!group) return { phase: state?.i_bet_you?.round?.status === 'complete' ? 'complete' : 'waiting' }
  return {
    phase: group.state,
    groupNumber: group.position,
    category: group.category.title,
    members: group.members,
    bidder: teamName(group, group.challenged_bidder_team_id ?? group.current_bidder_team_id),
    challenger: teamName(group, group.challenger_team_id),
    bid: group.target_bid ?? group.current_bid,
    seconds: iBetYouSecondsRemaining(state, now),
    result: group.result,
    winner: teamName(group, group.winning_team_id),
  }
}

export function iBetYouHostActions(group) {
  if (!group) return []
  if (group.state === 'waiting' || group.state === 'bidding') return ['select-bidder','decrement','increment','name-them']
  if (group.state === 'challenged') return ['correct-showdown','start-60s']
  if (group.state === 'countdown') return ['success','fail']
  if (group.state === 'result') return ['next-group']
  return []
}

export function iBetYouTeamModel(state, teamId) {
  const group = groupForTeam(state, teamId)
  const active = activeIBetYouGroup(state)
  if (!group) return { phase: 'unassigned' }
  return {
    phase: group.state,
    groupNumber: group.position,
    category: group.category.title,
    active: group.id === active?.id,
    won: group.winning_team_id === teamId,
  }
}

export const ACTIVE_EVENT_STATUSES=new Set(['lobby','ready','question','suspense','locked','reveal','leaderboard','round_complete'])

export function stateVersion(snapshot){
  const version=Number(snapshot?.event?.state_version)
  return Number.isFinite(version)?version:-1
}

export function shouldAcceptSnapshot(snapshot,acceptedVersion=-1){
  return stateVersion(snapshot)>=acceptedVersion
}

export function shouldPollEvent(snapshot,{hidden=false}={}){
  return Boolean(snapshot?.event&&!hidden&&ACTIVE_EVENT_STATUSES.has(snapshot.event.status))
}

export function realtimeRecovery(status){
  if(status==='SUBSCRIBED')return'hydrate'
  if(['TIMED_OUT','CHANNEL_ERROR','CLOSED'].includes(status))return'resubscribe'
  return'none'
}

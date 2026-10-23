export const ACTIVE_EVENT_STATUSES=new Set(['lobby','ready','question','suspense','locked','reveal','leaderboard','round_complete'])

export function stateVersion(snapshot){
  const version=Number(snapshot?.event?.state_version)
  return Number.isFinite(version)?version:-1
}

export function shouldAcceptSnapshot(snapshot,acceptedVersion=-1){
  return stateVersion(snapshot)>=acceptedVersion
}

// server_now and _hydratedAt change on every fetch without describing new game state.
const VOLATILE_SNAPSHOT_KEYS=new Set(['server_now','_hydratedAt'])

export function snapshotFingerprint(snapshot){
  return JSON.stringify(snapshot??null,(key,value)=>VOLATILE_SNAPSHOT_KEYS.has(key)?undefined:value)
}

// Apply newer versions, and equal versions only when their content differs
// (a few host-only writes do not bump state_version). Stale snapshots are rejected.
export function isSnapshotChange(snapshot,acceptedVersion=-1,acceptedFingerprint=null){
  if(!shouldAcceptSnapshot(snapshot,acceptedVersion))return false
  return stateVersion(snapshot)>acceptedVersion||snapshotFingerprint(snapshot)!==acceptedFingerprint
}

export function shouldPollEvent(snapshot,{hidden=false}={}){
  return Boolean(snapshot?.event&&!hidden&&ACTIVE_EVENT_STATUSES.has(snapshot.event.status))
}

export function realtimeRecovery(status){
  if(status==='SUBSCRIBED')return'hydrate'
  if(['TIMED_OUT','CHANNEL_ERROR','CLOSED'].includes(status))return'resubscribe'
  return'none'
}

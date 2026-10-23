import{describe,expect,it}from'vitest'
import{isSnapshotChange,realtimeRecovery,shouldAcceptSnapshot,shouldPollEvent,snapshotFingerprint,stateVersion}from'./state-sync.js'

describe('version-aware realtime recovery',()=>{
  const snapshot=(version,status='question')=>({event:{state_version:version,status}})
  it('never accepts version N after N+1',()=>{expect(shouldAcceptSnapshot(snapshot(8),9)).toBe(false);expect(shouldAcceptSnapshot(snapshot(9),9)).toBe(true);expect(stateVersion(snapshot(10))).toBe(10)})
  it('recovers successful and failed subscriptions',()=>{expect(realtimeRecovery('SUBSCRIBED')).toBe('hydrate');for(const status of['TIMED_OUT','CHANNEL_ERROR','CLOSED'])expect(realtimeRecovery(status)).toBe('resubscribe')})
  it('polls active visible events and stops when hidden or ended',()=>{expect(shouldPollEvent(snapshot(1))).toBe(true);expect(shouldPollEvent(snapshot(1),{hidden:true})).toBe(false);expect(shouldPollEvent(snapshot(1,'ended'))).toBe(false)})
})

describe('snapshot change detection',()=>{
  const snapshot=(version,extra={})=>({server_now:'2026-10-23T10:00:00Z',_hydratedAt:1,event:{state_version:version,status:'question'},...extra})
  const accepted=snapshot(4,{lie_count:1}),fingerprint=snapshotFingerprint(accepted)
  it('ignores an unchanged snapshot whose only differences are fetch timestamps',()=>{expect(isSnapshotChange({...snapshot(4,{lie_count:1}),server_now:'2026-10-23T10:00:07Z',_hydratedAt:99},4,fingerprint)).toBe(false)})
  it('applies a newer version',()=>{expect(isSnapshotChange(snapshot(5,{lie_count:1}),4,fingerprint)).toBe(true)})
  it('applies equal-version content changes from writes that do not bump the version',()=>{expect(isSnapshotChange(snapshot(4,{lie_count:2}),4,fingerprint)).toBe(true)})
  it('still rejects stale snapshots',()=>{expect(isSnapshotChange(snapshot(3,{lie_count:9}),4,fingerprint)).toBe(false)})
  it('applies the first snapshot',()=>{expect(isSnapshotChange(snapshot(0),-1,null)).toBe(true)})
})

import{describe,expect,it}from'vitest'
import{realtimeRecovery,shouldAcceptSnapshot,shouldPollEvent,stateVersion}from'./state-sync.js'

describe('version-aware realtime recovery',()=>{
  const snapshot=(version,status='question')=>({event:{state_version:version,status}})
  it('never accepts version N after N+1',()=>{expect(shouldAcceptSnapshot(snapshot(8),9)).toBe(false);expect(shouldAcceptSnapshot(snapshot(9),9)).toBe(true);expect(stateVersion(snapshot(10))).toBe(10)})
  it('recovers successful and failed subscriptions',()=>{expect(realtimeRecovery('SUBSCRIBED')).toBe('hydrate');for(const status of['TIMED_OUT','CHANNEL_ERROR','CLOSED'])expect(realtimeRecovery(status)).toBe('resubscribe')})
  it('polls active visible events and stops when hidden or ended',()=>{expect(shouldPollEvent(snapshot(1))).toBe(true);expect(shouldPollEvent(snapshot(1),{hidden:true})).toBe(false);expect(shouldPollEvent(snapshot(1,'ended'))).toBe(false)})
})

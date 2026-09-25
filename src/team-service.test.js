import { describe, expect, it, vi } from 'vitest'
import { ensureAnonymousSession,joinTeam,normalizeRoom, ROOM_PATTERN,secondsRemaining,setTeamMascot,shouldPollTeamState,teamRealtimeRecovery } from './team-service.js'

describe('room parsing', () => {
  it('normalizes a room query to uppercase', () => {
    expect(normalizeRoom(' abc123 ')).toBe('ABC123')
  })

  it('accepts only six uppercase alphanumeric characters', () => {
    expect(ROOM_PATTERN.test('ABC123')).toBe(true)
    expect(ROOM_PATTERN.test('ABC12')).toBe(false)
    expect(ROOM_PATTERN.test('ABC-12')).toBe(false)
  })
  it('joins with the selected mascot after checking existing membership',async()=>{
    const rpc=vi.fn().mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({error:null}).mockResolvedValueOnce({data:{team:{id:'t1',mascot_id:'frog'}},error:null})
    expect((await joinTeam({rpc},'ABC123',' Team Frog ','frog')).team.id).toBe('t1')
    expect(rpc).toHaveBeenNthCalledWith(2,'join_event',{p_room_code:'ABC123',p_team_name:'Team Frog',p_mascot_id:'frog'})
  })
  it('restores an existing team without creating or renaming it, even after gameplay starts',async()=>{
    const saved={team:{id:'t1'},event:{status:'question'}},rpc=vi.fn().mockResolvedValue({data:saved,error:null})
    expect(await joinTeam({rpc},'ABC123','New name','fox')).toBe(saved)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('recovers a committed join whose response was lost',async()=>{
    const saved={team:{id:'t1'}},rpc=vi.fn().mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({error:new Error('Network lost')}).mockResolvedValueOnce({data:saved,error:null})
    expect(await joinTeam({rpc},'ABC123','Team','fox')).toBe(saved)
    expect(rpc.mock.calls.filter(([name])=>name==='join_event')).toHaveLength(1)
  })
  it('does not create a team if existing membership cannot be checked',async()=>{
    const rpc=vi.fn().mockResolvedValue({error:new Error('Offline')})
    await expect(joinTeam({rpc},'ABC123','Team','fox')).rejects.toThrow('Offline')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('preserves the original join error when recovery also fails',async()=>{
    const rpc=vi.fn().mockResolvedValueOnce({data:null}).mockResolvedValueOnce({error:new Error('name taken')}).mockRejectedValueOnce(new Error('Offline'))
    await expect(joinTeam({rpc},'ABC123','Team','fox')).rejects.toThrow('name taken')
  })
  it('reuses the persisted anonymous identity on refresh without signing out or signing in',async()=>{
    const session={user:{id:'captain-1',is_anonymous:true}},auth={getSession:vi.fn().mockResolvedValue({data:{session}}),signOut:vi.fn(),signInAnonymously:vi.fn()}
    expect(await ensureAnonymousSession({auth})).toBe(session)
    expect(auth.signOut).not.toHaveBeenCalled();expect(auth.signInAnonymously).not.toHaveBeenCalled()
  })
  it('does not replace identity when reading the session fails',async()=>{
    const auth={getSession:vi.fn().mockResolvedValue({data:{},error:new Error('Unavailable')}),signInAnonymously:vi.fn()}
    await expect(ensureAnonymousSession({auth})).rejects.toThrow('Unavailable')
    expect(auth.signInAnonymously).not.toHaveBeenCalled()
  })
  it('changes only the owned Team mascot through its RPC',async()=>{const rpc=vi.fn().mockResolvedValue({data:{mascot_id:'robot'},error:null});await setTeamMascot({rpc},'t1','robot');expect(rpc).toHaveBeenCalledWith('set_team_mascot',{p_team_id:'t1',p_mascot_id:'robot'})})
  it('rehydrates on subscription and reconnects failed channels',()=>{expect(teamRealtimeRecovery('SUBSCRIBED')).toBe('hydrate');expect(teamRealtimeRecovery('TIMED_OUT')).toBe('resubscribe');expect(teamRealtimeRecovery('CHANNEL_ERROR')).toBe('resubscribe');expect(teamRealtimeRecovery('CLOSED')).toBe('resubscribe')})
  it('uses generic fallback recovery before the client knows which game starts',()=>{expect(shouldPollTeamState({team:{id:'t1'},event:{status:'lobby'}})).toBe(true);expect(shouldPollTeamState({team:{id:'t1'},event:{status:'ready'}})).toBe(true);expect(shouldPollTeamState({team:{id:'t1'},event:{status:'round_complete'}})).toBe(true);expect(shouldPollTeamState({team:{id:'t1'},event:{status:'question'}})).toBe(true)})
  it('pauses generic recovery while hidden and stops only for an ended event',()=>{const joined={team:{id:'t1'},event:{status:'leaderboard'}};expect(shouldPollTeamState(joined)).toBe(true);expect(shouldPollTeamState(joined,{hidden:true})).toBe(false);expect(shouldPollTeamState({team:{id:'t1'},event:{status:'ended'}})).toBe(false);expect(shouldPollTeamState({event:{status:'ready'}})).toBe(false)})
  it('restores timer from authoritative server time without restarting',()=>{const state={event:{question_deadline_at:'2026-08-19T12:00:20Z'},server_now:'2026-08-19T12:00:10Z',_hydratedAt:1000};expect(secondsRemaining(state,4000)).toBe(7);expect(secondsRemaining(state,12000)).toBe(0)})
})

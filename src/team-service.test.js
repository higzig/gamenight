import { describe, expect, it, vi } from 'vitest'
import { joinTeam,normalizeRoom, ROOM_PATTERN,setTeamMascot } from './team-service.js'

describe('room parsing', () => {
  it('normalizes a room query to uppercase', () => {
    expect(normalizeRoom(' abc123 ')).toBe('ABC123')
  })

  it('accepts only six uppercase alphanumeric characters', () => {
    expect(ROOM_PATTERN.test('ABC123')).toBe(true)
    expect(ROOM_PATTERN.test('ABC12')).toBe(false)
    expect(ROOM_PATTERN.test('ABC-12')).toBe(false)
  })
  it('joins with the selected mascot',async()=>{const rpc=vi.fn().mockResolvedValue({data:{},error:null});rpc.mockResolvedValueOnce({data:{},error:null}).mockResolvedValueOnce({data:{team:{mascot_id:'frog'}},error:null});await joinTeam({rpc},'ABC123','Team Frog','frog');expect(rpc).toHaveBeenNthCalledWith(1,'join_event',{p_room_code:'ABC123',p_team_name:'Team Frog',p_mascot_id:'frog'})})
  it('changes only the owned Team mascot through its RPC',async()=>{const rpc=vi.fn().mockResolvedValue({data:{mascot_id:'robot'},error:null});await setTeamMascot({rpc},'t1','robot');expect(rpc).toHaveBeenCalledWith('set_team_mascot',{p_team_id:'t1',p_mascot_id:'robot'})})
})

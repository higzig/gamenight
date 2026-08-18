import {describe,expect,it,vi} from 'vitest'
import {hydrateAudience,normalizeAudienceState} from './audience-service.js'

describe('Audience aggregate hydration',()=>{
  it('never leaves the submitted count undefined',()=>expect(normalizeAudienceState({}).submitted_count).toBe(0))
  it('renders an authoritative zero submitted count',()=>expect(normalizeAudienceState({submitted_count:0}).submitted_count).toBe(0))
  it('normalizes the legacy aggregate wire field without retaining it',()=>{const state=normalizeAudienceState({answer_count:2});expect(state).toEqual({submitted_count:2});expect(state).not.toHaveProperty('answer_count')})
  it('uses the current submitted_count in preference to a stale legacy value',()=>expect(normalizeAudienceState({submitted_count:3,answer_count:1}).submitted_count).toBe(3))
  it('rehydrates increments and refreshes from the authoritative RPC value',async()=>{const rpc=vi.fn().mockResolvedValueOnce({data:{submitted_count:1},error:null}).mockResolvedValueOnce({data:{submitted_count:2},error:null});expect((await hydrateAudience({rpc},'ABC123')).submitted_count).toBe(1);expect((await hydrateAudience({rpc},'ABC123')).submitted_count).toBe(2)})
  it('preserves aggregate suspense and reveal state without deriving guesses',()=>{expect(normalizeAudienceState({event:{status:'suspense'},submitted_count:2,guess_markers:[]})).toMatchObject({submitted_count:2,guess_markers:[]});expect(normalizeAudienceState({event:{status:'reveal'},submitted_count:2,guess_markers:[{guess:40}]}).event.status).toBe('reveal')})
})

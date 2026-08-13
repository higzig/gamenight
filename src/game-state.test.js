import { describe, expect, it } from 'vitest'
import { containsSecretData } from './audience-service.js'
import { secondsRemaining } from './team-service.js'
import { authoritativeSubmissionCount, canSubmitGuess, teamRevealResult } from './game-state.js'

describe('authoritative gameplay hydration',()=>{
  it('derives Team timer from server deadline and hydration time',()=>{
    const state={server_now:'2026-08-13T12:00:00Z',event:{question_deadline_at:'2026-08-13T12:00:15Z'},_hydratedAt:1000}
    expect(secondsRemaining(state,6000)).toBe(10)
  })
  it('rejects secret or unrevealed-answer audience payloads',()=>{
    expect(containsSecretData({event:{status:'question'},question:{date_of_birth:'2000-01-01'}})).toBe(true)
    expect(containsSecretData({event:{status:'question'},question:{correct_age:26}})).toBe(true)
    expect(containsSecretData({event:{status:'reveal'},question:{correct_age:26}})).toBe(false)
  })
  it('models refresh recovery from authoritative submitted state',()=>{
    const refreshed={submission:{id:'s1',guess_integer:42},award:null}
    expect(refreshed.submission.guess_integer).toBe(42)
  })
  it('prevents a second submission after hydration returns an accepted row',()=>{
    const state={team:{id:'t1'},question:{id:'q1'},submission:{id:'s1'},server_now:'2026-08-13T12:00:00Z',_hydratedAt:0,event:{status:'question',accepting_answers:true,question_deadline_at:'2026-08-13T12:00:15Z'}}
    expect(canSubmitGuess(state,5000)).toBe(false)
  })
  it('derives Team reveal result from authoritative award metadata',()=>{
    expect(teamRevealResult({event:{status:'reveal'},question:{correct_age:42},submission:{guess_integer:40},award:{points:6,metadata:{difference:2}}})).toEqual({correctAge:42,guess:40,points:6,difference:2})
  })
  it('counts only authoritative accepted Admin submissions',()=>{
    expect(authoritativeSubmissionCount({submissions:[{guess_integer:21},{guess_integer:null},{guess_integer:30}]})).toBe(2)
  })
})

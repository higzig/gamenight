// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { animateAge, audienceMode, buildAgeScale, differencePresentation, revealOrder, scatterGuessMarkers, suspenseSeconds, teamJoinUrl } from './audience-view.js'

describe('Phase 2C audience experience', () => {
  it('builds the QR target from the deployed origin and room query', () => {
    expect(teamJoinUrl('https://games.example', 'ABC123')).toBe('https://games.example/team.html?room=ABC123')
  })
  it('derives the server suspense countdown', () => {
    expect(suspenseSeconds({server_now:'2026-08-13T12:00:00Z',_hydratedAt:1000,event:{status:'suspense',question_reveal_due_at:'2026-08-13T12:00:05Z'}},3000)).toBe(3)
  })
  it('lets Host display mode switch between QR, leaderboard, and the game', () => {
    expect(audienceMode({event:{display_mode:'join',status:'question'},question:{}})).toBe('join')
    expect(audienceMode({event:{display_mode:'leaderboard',status:'reveal'},question:{}})).toBe('leaderboard')
    expect(audienceMode({event:{display_mode:'game',status:'reveal'},question:{}})).toBe('reveal')
  })
  it('reveals digits from right to left for arbitrary lengths', () => {
    expect(revealOrder(407)).toEqual([2,1,0])
  })
  it('finishes the animation on the correct age', async () => {
    const target=document.createElement('strong')
    await animateAge({age:47,target,sleep:()=>Promise.resolve()})
    expect(target.textContent).toBe('47')
  })
  it('uses a clean reduced-motion reveal', async () => {
    const target=document.createElement('strong'),sleep=vi.fn()
    await animateAge({age:104,target,reducedMotion:true,sleep})
    expect(target.textContent).toBe('104');expect(sleep).not.toHaveBeenCalled()
  })
  it('keeps submitted marker positions stable without Team names',()=>{const markers=[{mascot_id:'frog',guess:38}];expect(scatterGuessMarkers(markers)).toEqual(scatterGuessMarkers(markers));expect(scatterGuessMarkers(markers)[0]).not.toHaveProperty('team_name')})
  it('orders scale markers and stacks same-age guesses into lanes',()=>{const scale=buildAgeScale([{guess:52,team_name:'B'},{guess:43,team_name:'A'},{guess:43,team_name:'C'}],47);expect(scale.markers.map(x=>x.guess)).toEqual([43,43,52]);expect(scale.markers.slice(0,2).map(x=>x.lane)).toEqual([0,1]);expect(scale.answerPosition).toBeGreaterThan(scale.markers[0].position)})
  it('describes below, above, and exact differences correctly',()=>{expect(differencePresentation(-5)).toEqual({short:'-5',long:'5 YEARS LOW'});expect(differencePresentation(5)).toEqual({short:'+5',long:'5 YEARS HIGH'});expect(differencePresentation(0).long).toBe('EXACT!')})
})

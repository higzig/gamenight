// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { animateAge,animateCountUp,answeringPresentation,audienceMode,buildAgeScale,buildCountUpTrack,differencePresentation,distanceDirection,lockCountChange,resultPointsLabel,revealFrame,revealLayout,revealOrder,scatterGuessMarkers,suspenseSeconds,teamJoinUrl } from './audience-view.js'

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
  it('sends low guesses rightward, high guesses leftward, and exact guesses nowhere',()=>{expect(distanceDirection(-17)).toBe('right');expect(distanceDirection(6)).toBe('left');expect(distanceDirection(0)).toBe('exact')})
  it('renders zero points neutrally and positive awards clearly',()=>{expect(resultPointsLabel(0)).toBe('0 PTS');expect(resultPointsLabel(6)).toBe('+6')})
  it.each([2,4,6,8])('provides a readable final-card grid for %i Teams',count=>{const layout=revealLayout(count);expect(layout.columns).toBeGreaterThanOrEqual(2);expect(layout.columns).toBeLessThanOrEqual(4);expect(layout.count).toBe(count)})
  it('keeps scale positions padded from the viewport edges',()=>{const scale=buildAgeScale([{guess:20},{guess:80}],49);expect(scale.markers[0].position).toBeGreaterThan(0);expect(scale.markers[1].position).toBeLessThan(100)})
  it('presents only the aggregate answering count',()=>expect(answeringPresentation(4,7)).toEqual({countText:'4 / 7',label:'TEAMS LOCKED IN',pop:false,individualGuesses:[]}))
  it('pops only when the authoritative count increases',()=>{expect(lockCountChange(3,4,false).pop).toBe(true);expect(lockCountChange(4,4,false).pop).toBe(false);expect(lockCountChange(3,4,true).pop).toBe(false)})
  it('starts the live reveal at one and grows monotonically',async()=>{const track=buildCountUpTrack([{guess:3},{guess:7}],5),ages=[];await animateCountUp({track,onFrame:frame=>ages.push(frame.age),sleep:()=>Promise.resolve()});expect(ages[0]).toBe(1);expect(ages.at(-1)).toBe(7);expect(ages.every((age,index)=>index===0||age>=ages[index-1])).toBe(true)})
  it('grows primary then subdued overshoot progress',()=>{const track=buildCountUpTrack([{guess:68}],49),before=revealFrame(45,track),after=revealFrame(55,track);expect(before.primaryProgress).toBeGreaterThan(0);expect(before.overshootProgress).toBe(0);expect(after.primaryProgress).toBe((49/68)*100);expect(after.overshootProgress).toBeGreaterThan(0);expect(after.overshooting).toBe(true)})
  it('reveals guesses only when crossed and groups equal ages together',()=>{const track=buildCountUpTrack([{team_name:'A',guess:45},{team_name:'B',guess:45},{team_name:'C',guess:68}],49);expect(revealFrame(44,track).revealedMarkers).toHaveLength(0);expect(revealFrame(45,track).revealedMarkers.map(x=>x.team_name)).toEqual(['A','B']);expect(revealFrame(49,track).correctReached).toBe(true);expect(revealFrame(67,track).revealedMarkers).toHaveLength(2);expect(revealFrame(68,track).revealedMarkers).toHaveLength(3)})
  it('pauses at the correct age before high guesses',async()=>{const track=buildCountUpTrack([{guess:8}],5),sleeps=[];await animateCountUp({track,sleep:ms=>{sleeps.push(ms);return Promise.resolve()}});expect(sleeps).toContain(900)})
  it('skips travelling animation for reduced motion',async()=>{const track=buildCountUpTrack([{guess:68}],49),frames=[],sleep=vi.fn();await animateCountUp({track,reducedMotion:true,onFrame:f=>frames.push(f),sleep});expect(frames).toHaveLength(1);expect(frames[0].age).toBe(68);expect(sleep).not.toHaveBeenCalled()})
})

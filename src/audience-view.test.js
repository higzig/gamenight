// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { animateAge, audienceMode, revealOrder, suspenseSeconds, teamJoinUrl } from './audience-view.js'

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
})

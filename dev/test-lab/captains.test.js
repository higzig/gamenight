import { describe, expect, it } from 'vitest'
import { isSimulatedUser, uniqueTeamName } from './captains.js'

describe('Simulated Captains', () => {
  it('recognises only tagged anonymous Captains as simulated', () => {
    expect(isSimulatedUser({ is_anonymous: true, user_metadata: { game_night_test_lab: true } })).toBe(true)
    expect(isSimulatedUser({ is_anonymous: true, user_metadata: {} })).toBe(false)
    expect(isSimulatedUser({ is_anonymous: false, user_metadata: { game_night_test_lab: true } })).toBe(false)
  })
  it('never reuses a team name already in the room', () => {
    const taken = ['Quiztopher Walken', 'ctrl alt  defeat']
    for (let i = 0; i < 50; i++) { const name = uniqueTeamName(taken); expect(['quiztopher walken', 'ctrl alt defeat']).not.toContain(name.toLowerCase()) }
    expect(uniqueTeamName(Array.from({ length: 40 }, (_, i) => `Team ${i}`))).toBeTruthy()
  })
})

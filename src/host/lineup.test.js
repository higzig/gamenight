import { describe, expect, it } from 'vitest'
import { addGame, adoptedLineup, moveGame, nightStartCheck, removeGame, replaceGame, serverLineupTypes } from './lineup.js'
import { GAME_CATALOG, GAME_ESTIMATES, RECOMMENDED_LINEUP, toGameTypes } from './game-catalog.js'

describe('Running-order operations', () => {
  const order = ['guessAge', 'noContext', 'iBetYou']
  it('adds a game at the end, once, up to four games', () => {
    expect(addGame(order, 'perfectLie')).toEqual([...order, 'perfectLie'])
    expect(addGame(order, 'noContext')).toBe(order)
    expect(addGame([...order, 'perfectLie'], 'guessAge')).toHaveLength(4)
    expect(addGame(order, 'bingo')).toBe(order)
  })
  it('replaces a game in place and refuses a duplicate', () => {
    expect(replaceGame(order, 'noContext', 'perfectLie')).toEqual(['guessAge', 'perfectLie', 'iBetYou'])
    expect(replaceGame(order, 'noContext', 'iBetYou')).toBe(order)
  })
  it('removes and moves games without mutating the input', () => {
    const copy = [...order]
    expect(removeGame(order, 'noContext')).toEqual(['guessAge', 'iBetYou'])
    expect(moveGame(order, 'iBetYou', 0)).toEqual(['iBetYou', 'guessAge', 'noContext'])
    expect(moveGame(order, 'guessAge', 5)).toBe(order)
    expect(order).toEqual(copy)
  })
})

describe('Server running order', () => {
  it('reads the server order and maps game types', () => {
    expect(serverLineupTypes({ lineup: { games: [{ game_type: 'no_context' }, { game_type: 'guess_age' }] } })).toEqual(['noContext', 'guessAge'])
    expect(toGameTypes(['perfectLie', 'iBetYou'])).toEqual(['perfect_lie', 'i_bet_you'])
  })
  it('adopts a stored browser plan, honouring removed games, or else server content order', () => {
    expect(adoptedLineup({}, { games: [{ type: 'iBetYou' }, { type: 'future' }, { type: 'iBetYou' }, { type: 'guessAge' }] })).toEqual(['iBetYou', 'guessAge'])
    expect(adoptedLineup({ rounds: [{ game_type: 'guess_age', position: 1 }] }, { games: [] })).toEqual([])
    expect(adoptedLineup({ rounds: [{ game_type: 'guess_age', position: 3 }], no_context: { round: { game_type: 'no_context', position: 1 } } }, null)).toEqual(['noContext', 'guessAge'])
    expect(adoptedLineup({}, null)).toEqual([])
  })
  it('only allows Start Game Night with configured games', () => {
    expect(nightStartCheck([])).toMatchObject({ canStart: false, reason: 'Add at least one game to start the night.' })
    expect(nightStartCheck([{ type: 'perfectLie', state: 'needs_setup' }, { type: 'guessAge', state: 'ready' }])).toMatchObject({ canStart: false, reason: 'Finish setting up Table of Lies first.' })
    expect(nightStartCheck([{ type: 'guessAge', state: 'ready' }])).toMatchObject({ canStart: true })
  })
})

describe('Game catalogue', () => {
  it('describes every game with editable provisional estimates and original artwork', () => {
    expect(RECOMMENDED_LINEUP).toEqual(['guessAge', 'noContext', 'iBetYou'])
    for (const [type, game] of Object.entries(GAME_CATALOG)) {
      expect(game).toMatchObject({ type, duration: GAME_ESTIMATES[type].duration, teams: GAME_ESTIMATES[type].teams })
      expect(game.howToPlay.length).toBeGreaterThan(1)
      expect(game.art).toMatch(/^<svg[^>]*aria-hidden="true"/)
      expect(game.art).not.toMatch(/https?:/)
    }
  })
})

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { dashboardMarkup, libraryMarkup } from './dashboard.js'

const game = (type, state, extra = {}) => ({ id: type, type, position: 1, state, status: ['live', 'paused', 'complete'].includes(state) ? state : 'upcoming', settings: { celebrities: [], categories: [] }, editable: !['live', 'paused', 'complete'].includes(state), configIssue: state === 'needs_setup' ? 'Add at least one question.' : null, ...extra })
const model = extra => ({ event: { name: 'Quiz <Night>', venue: 'The Oval', date: '25 Sept 2026', roomCode: 'ABC123' }, teamCount: 3, games: [], started: false, busy: false, live: null, pausedGame: null, next: null, finished: false, startCheck: { canStart: true, reason: '', blocking: [] }, ...extra })
const render = extra => { document.body.innerHTML = dashboardMarkup(model(extra)); return document.body }

describe('Dashboard markup', () => {
  it('keeps one heading for the project and shows status, room and teams compactly', () => {
    const root = render()
    expect(root.querySelector('.gn-hero h1, .gn-hero h2')).toBeNull()
    expect(root.querySelector('.gn-night-pill').textContent).toBe('Planning')
    expect(root.querySelector('[data-action="copy-link"]').textContent).toContain('ABC123')
    expect(root.querySelector('[data-action="teams"]').textContent).toContain('3')
    expect(render({ started: true }).querySelector('.gn-night-pill').textContent).toBe('Hosting')
  })
  it('labels every status and only lets upcoming games be edited, replaced, removed or reordered', () => {
    const games = ['needs_setup', 'ready', 'live', 'paused', 'complete'].map((state, i) => game(['perfectLie', 'guessAge', 'noContext', 'iBetYou', 'guessAge'][i], state, { position: i + 1 }))
    const root = render({ games: games.slice(0, 4) })
    expect([...root.querySelectorAll('.gn-status')].map(el => el.textContent.replace('● ', ''))).toEqual(['Needs Setup', 'Ready', 'Live', 'Paused'])
    expect(root.querySelector('[data-state="live"] [data-action="remove"]')).toBeNull()
    expect(root.querySelector('[data-state="live"]').getAttribute('draggable')).toBeNull()
    expect(root.querySelector('[data-state="ready"] [data-action="remove"]')).not.toBeNull()
    expect(root.querySelector('[data-state="needs_setup"] .gn-card-primary').textContent).toBe('Set up')
    document.body.innerHTML = dashboardMarkup(model({ games: [games[4]] }))
    expect(document.querySelector('[data-state="complete"] .gn-card-primary').textContent).toContain('Results')
  })
  it('never relies on hover: reorder buttons are labelled and disabled at the edges', () => {
    const root = render({ games: [game('guessAge', 'ready', { position: 1 }), game('noContext', 'ready', { position: 2 })] })
    expect(root.querySelector('[data-type="guessAge"][data-action="move-up"]').disabled).toBe(true)
    expect(root.querySelector('[data-type="guessAge"][data-action="move-down"]').getAttribute('aria-label')).toBe('Move Guess the Age later')
    expect(root.querySelector('[data-type="noContext"][data-action="move-down"]').disabled).toBe(true)
  })
  it('disables every action while a change is saving', () => {
    const root = render({ games: [game('guessAge', 'ready')], busy: true })
    expect([...root.querySelectorAll('.gn-card [data-action]')].every(button => button.disabled)).toBe(true)
  })
  it('shows the live game prominently', () => {
    const live = game('noContext', 'live')
    expect(render({ games: [live], live, started: true }).querySelector('.gn-hero-primary').textContent).toContain('LIVE — No Context')
  })
})

describe('Game library', () => {
  it('shows how to play and blocks games already in the line-up', () => {
    document.body.innerHTML = libraryMarkup({ mode: 'replace', target: 'noContext', lineup: ['guessAge', 'noContext'] })
    expect(document.querySelector('[data-library-pick="noContext"]').textContent).toBe('Current game')
    expect(document.querySelector('[data-library-pick="guessAge"]').disabled).toBe(true)
    expect(document.querySelector('[data-library-pick="iBetYou"]').textContent).toBe('Replace with I Bet You')
    expect(document.querySelectorAll('.gn-how li').length).toBeGreaterThanOrEqual(12)
  })
})

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { classifyProjects, projectCard, projectStatus } from './projects.js'

const p = (extra = {}) => ({ id: 'a', name: 'Quiz', room_code: 'ABC123', event_date: '2026-10-23', status: 'lobby', created_at: '2026-10-01', started_at: null, games: [], ...extra })
describe('My Projects', () => {
  it('derives Planning, Hosting and Live from server state', () => {
    expect(projectStatus(p())).toBe('planning')
    expect(projectStatus(p({ started_at: 'x' }))).toBe('hosting')
    expect(projectStatus(p({ status: 'round_complete' }))).toBe('hosting')
    expect(projectStatus(p({ status: 'question', started_at: 'x' }))).toBe('live')
  })
  it('archives only hosted projects whose date has passed and lists live projects first', () => {
    const { current, archived } = classifyProjects([p({ id: 'old-plan', event_date: '2026-09-01' }), p({ id: 'hosted', event_date: '2026-09-01', started_at: 'x' }), p({ id: 'live', status: 'reveal', started_at: 'x', created_at: '2026-01-01' })], '2026-10-23')
    expect(current.map(x => x.id)).toEqual(['live', 'old-plan']); expect(archived.map(x => x.id)).toEqual(['hosted'])
  })
  it('escapes project names and summarises games', () => {
    document.body.innerHTML = projectCard(p({ name: '<b>Quiz</b>', games: ['perfect_lie'] }))
    expect(document.querySelector('h3').textContent).toBe('<b>Quiz</b>')
    expect(document.querySelector('.gn-project-meta').textContent).toContain('1 game ·')
    expect(document.querySelector('.gn-project-games li').dataset.game).toBe('perfectLie')
  })
})

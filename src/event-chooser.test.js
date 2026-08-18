import { describe, expect, it } from 'vitest'
import { classifyEvents, humanEventStatus, localCalendarDate } from './event-chooser.js'

const event = (id, event_date, status = 'lobby') => ({ id, name: id, event_date, status })

describe('event chooser classification', () => {
  it('keeps today and future events current while archiving past events', () => {
    const result = classifyEvents([
      event('past', '2026-08-17'), event('future', '2026-08-20'), event('today', '2026-08-18'),
    ], '2026-08-18')
    expect(result.current.map(item => item.id)).toEqual(['today', 'future'])
    expect(result.archived.map(item => item.id)).toEqual(['past'])
  })

  it('sorts upcoming nearest-first and archived most-recent-first', () => {
    const result = classifyEvents([
      event('far-future', '2026-09-01'), event('old', '2026-07-01'),
      event('near-future', '2026-08-19'), event('recent', '2026-08-17'),
    ], '2026-08-18')
    expect(result.current.map(item => item.id)).toEqual(['near-future', 'far-future'])
    expect(result.archived.map(item => item.id)).toEqual(['recent', 'old'])
  })

  it('keeps a live past event accessible in the current list', () => {
    const result = classifyEvents([event('live-past', '2026-08-10', 'question')], '2026-08-18')
    expect(result.current.map(item => item.id)).toEqual(['live-past'])
    expect(result.archived).toEqual([])
  })

  it('uses local calendar components rather than UTC conversion', () => {
    expect(localCalendarDate(new Date(2026, 7, 18, 23, 30))).toBe('2026-08-18')
  })

  it('uses human-facing statuses', () => {
    expect(humanEventStatus('question')).toBe('Live')
    expect(humanEventStatus('round_complete')).toBe('Completed')
    expect(humanEventStatus('lobby')).toBe('Lobby')
  })
})

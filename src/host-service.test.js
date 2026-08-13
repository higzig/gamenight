import { describe, expect, it, vi } from 'vitest'
import { createJoinableEvent, isAnonymousUser } from './host-service.js'

describe('Host service', () => {
  it('recognizes anonymous Auth users', () => {
    expect(isAnonymousUser({ is_anonymous: true })).toBe(true)
    expect(isAnonymousUser({ is_anonymous: false })).toBe(false)
  })

  it('creates an event before opening its lobby', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { id: 'event-id' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'event-id', status: 'lobby' }, error: null })
    const id = await createJoinableEvent({ rpc }, { name: 'Night', venue: 'Pub', eventDate: '2026-08-20', expectedTeams: 12 })
    expect(id).toBe('event-id')
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['create_event', 'open_event_lobby'])
  })
})

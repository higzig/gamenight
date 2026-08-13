import { describe, expect, it } from 'vitest'
import { normalizeRoom, ROOM_PATTERN } from './team-service.js'

describe('room parsing', () => {
  it('normalizes a room query to uppercase', () => {
    expect(normalizeRoom(' abc123 ')).toBe('ABC123')
  })

  it('accepts only six uppercase alphanumeric characters', () => {
    expect(ROOM_PATTERN.test('ABC123')).toBe(true)
    expect(ROOM_PATTERN.test('ABC12')).toBe(false)
    expect(ROOM_PATTERN.test('ABC-12')).toBe(false)
  })
})
